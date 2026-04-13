/**
 * In-memory ring buffer for MQTT activity events.
 * Module-level state (no class instantiation) per project conventions.
 */

type MqttEventType = 'connect' | 'disconnect' | 'publish' | 'subscribe' | 'error';

interface MqttActivityEvent {
  timestamp: string; // ISO 8601
  type: MqttEventType;
  detail: string; // Human-readable detail
}

const MAX_EVENTS = 100;
const events: MqttActivityEvent[] = [];

export function pushEvent(type: MqttEventType, detail: string): void {
  const event: MqttActivityEvent = {
    timestamp: new Date().toISOString(),
    type,
    detail,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift(); // Drop oldest
  }
}

export function getEvents(): MqttActivityEvent[] {
  return [...events]; // Return copy, newest last
}
