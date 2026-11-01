import { existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from "node:fs";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { get, put, transaction } from "./store.js";
import { jevProviderOf } from "../shared/types.js";

const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OPENAI_API_KEY", "TYPESAFE_API_KEY", "TYPESAFE_PROVIDER"] as const;
type Settings = Partial<Record<(typeof names)[number], string>>;
const inherited = new Set(Object.keys(process.env));
const inheritedKeyProvider = jevProviderOf(process.env.TYPESAFE_PROVIDER);
const configPath = process.env.MAIL_CONFIG_PATH || ".env";

function legacySettings() {
  const text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  return { text, values: parseEnv(text) };
}

function withoutManagedSettings(text: string, values: ReturnType<typeof parseEnv>) {
  // Preserve unrelated lines verbatim, including multiline quoted values. Check
  // the result with Node's parser before allowing any plaintext cleanup.
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const retained: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let entry = lines[i];
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*([\s\S]*)$/.exec(entry);
    if (!match) { retained.push(entry); continue; }
    const quote = match[2][0];
    if (["'", '"', "`"].includes(quote)) {
      let value = match[2].slice(1);
      while (!value.includes(quote) && i + 1 < lines.length) {
        const next = lines[++i];
        entry += next;
        value += next;
      }
      if (!value.includes(quote)) throw new Error("Cannot safely migrate the connection settings file.");
    }
    if (!names.includes(match[1] as (typeof names)[number])) retained.push(entry);
  }
  const cleaned = retained.join("");
  const expected = Object.fromEntries(Object.entries(values).filter(([name]) => !names.includes(name as (typeof names)[number])));
  if (!isDeepStrictEqual({ ...parseEnv(cleaned) }, expected)) throw new Error("Cannot safely migrate the connection settings file.");
  return cleaned;
}

function persist(settings: Settings) {
  transaction(() => {
    put("config", "connection", settings);
    if (!isDeepStrictEqual(get("config", "connection"), settings)) throw new Error("Encrypted connection settings could not be verified.");
  });
  // A committed encrypted readback is required before plaintext is removed.
  if (!isDeepStrictEqual(get("config", "connection"), settings)) throw new Error("Encrypted connection settings could not be verified.");
}

function cleanLegacy(text: string, cleaned: string) {
  if (text === cleaned) return;
  // Never place the original credentials in a backup or temporary file.
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, cleaned);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(temporary);
    throw error;
  }
  closeSync(descriptor);
  try { renameSync(temporary, configPath); }
  catch (error) { unlinkSync(temporary); throw error; }
}

/** Load saved settings, respecting launch overrides and the credential's provider. */
export function loadConfiguration() {
  const legacy = legacySettings();
  const cleaned = withoutManagedSettings(legacy.text, legacy.values);
  const saved = get("config", "connection");
  const settings: Settings = { ...saved };
  for (const name of names) if (settings[name] === undefined && legacy.values[name] !== undefined) settings[name] = legacy.values[name];
  const savedProvider = settings.TYPESAFE_PROVIDER ?? legacy.values.TYPESAFE_PROVIDER;
  const effectiveProvider = inherited.has("TYPESAFE_PROVIDER") ? process.env.TYPESAFE_PROVIDER : savedProvider;
  if (inherited.has("TYPESAFE_API_KEY") && process.env.TYPESAFE_API_KEY && jevProviderOf(effectiveProvider) !== inheritedKeyProvider)
    throw new Error("Change the inherited provider and credential together in the launch environment.");
  // A saved key keeps the provider identity it was saved with. Reuse under a
  // different inherited provider would send one vendor's key to another.
  if (!inherited.has("TYPESAFE_API_KEY") && settings.TYPESAFE_API_KEY &&
      jevProviderOf(savedProvider) !== jevProviderOf(effectiveProvider))
    throw new Error("The saved decision-model key belongs to another provider. Change the inherited provider and credential together.");
  if (Object.keys(settings).length && !isDeepStrictEqual(saved, settings)) persist(settings);
  cleanLegacy(legacy.text, cleaned);
  for (const [name, value] of Object.entries({ ...legacy.values, ...settings })) {
    if (!inherited.has(name)) process.env[name] = value;
  }
}

/** Save settings after checking provider and credential pairing under launch precedence. */
export function saveConfiguration(updates: Settings) {
  const legacy = legacySettings();
  const cleaned = withoutManagedSettings(legacy.text, legacy.values);
  const settings: Settings = { ...get("config", "connection") };
  // A stored key belongs to the provider stored with it, not to a launch
  // override. Capture that pairing before the update can replace either part.
  const storedProvider = settings.TYPESAFE_PROVIDER ?? legacy.values.TYPESAFE_PROVIDER;
  const launchProvider = inherited.has("TYPESAFE_PROVIDER") ? process.env.TYPESAFE_PROVIDER : undefined;
  for (const name of names) {
    if (settings[name] === undefined && legacy.values[name] !== undefined) settings[name] = legacy.values[name];
    if (updates[name]) settings[name] = updates[name];
  }
  // A provider change cannot carry a key stored for another vendor; a vendor
  // key left in place would be sent to the newly selected provider.
  if (
    updates.TYPESAFE_PROVIDER && !updates.TYPESAFE_API_KEY &&
    settings.TYPESAFE_API_KEY !== undefined &&
    jevProviderOf(updates.TYPESAFE_PROVIDER) !== jevProviderOf(storedProvider)
  )
    delete settings.TYPESAFE_API_KEY;
  // Launch precedence decides which vendor is actually used, so the requested
  // provider and its replacement key are validated together after precedence.
  const savedProvider = settings.TYPESAFE_PROVIDER ?? legacy.values.TYPESAFE_PROVIDER;
  const effectiveProvider = launchProvider ?? savedProvider;
  if (launchProvider && updates.TYPESAFE_PROVIDER &&
      jevProviderOf(updates.TYPESAFE_PROVIDER) !== jevProviderOf(launchProvider))
    throw new Error("Change the inherited provider and credential together in the launch environment.");
  const requestedProvider = updates.TYPESAFE_PROVIDER ?? launchProvider;
  if (updates.TYPESAFE_API_KEY) {
    if (jevProviderOf(requestedProvider ?? savedProvider) !== jevProviderOf(effectiveProvider))
      throw new Error("Save the decision-model key with its own provider.");
    // Persist the vendor the key belongs to, so a restart without the launch
    // values cannot pair the saved key with another provider.
    if (requestedProvider) settings.TYPESAFE_PROVIDER = requestedProvider;
  }
  // An inherited key keeps the provider identity it had in the launch
  // environment. A saved provider change cannot redirect it to another vendor.
  if (inherited.has("TYPESAFE_API_KEY") && process.env.TYPESAFE_API_KEY &&
      jevProviderOf(effectiveProvider) !== inheritedKeyProvider)
    throw new Error("Change the inherited provider and credential together in the launch environment.");
  // A stored key that launch precedence overrides never becomes effective, so
  // only reject a mismatched stored pair when the saved key would be used.
  if (!inherited.has("TYPESAFE_API_KEY") && settings.TYPESAFE_API_KEY &&
      jevProviderOf(settings.TYPESAFE_PROVIDER ?? legacy.values.TYPESAFE_PROVIDER) !== jevProviderOf(effectiveProvider))
    throw new Error("The saved decision-model key belongs to another provider. Change the inherited provider and credential together.");
  persist(settings);
  cleanLegacy(legacy.text, cleaned);
  for (const name of names) {
    if (inherited.has(name)) continue;
    if (settings[name] !== undefined) process.env[name] = settings[name];
    else delete process.env[name];
  }
}
