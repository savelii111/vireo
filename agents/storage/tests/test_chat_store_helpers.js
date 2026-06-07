// Re-export the mock pool helper so the studio's PG integration tests
// can use the exact same in-memory pool as the storage tests. Keeps the
// SQL coverage in one place.
export { makeMockPool } from "./test_chat_store.js";
