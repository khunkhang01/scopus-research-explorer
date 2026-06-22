// Minimal stub for the 'obsidian' module used in unit tests.
// Only exports referenced by src files that are imported in tests need to be here.
export const requestUrl = async (_options: unknown) => ({ status: 200, json: {}, text: "" });
