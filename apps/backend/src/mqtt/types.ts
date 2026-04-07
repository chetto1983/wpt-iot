// MQTT client lifecycle is owned by `connectionManager.ts` since the broker
// host/port/identity now come from the DB and can be reloaded at runtime.
// Use `getMqttClient()` from connectionManager instead of decorating Fastify.
export {};
