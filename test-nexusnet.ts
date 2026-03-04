import { NexusNetRelay } from './src/engines/nexusnet-relay.js';

async function test() {
  const relay = new NexusNetRelay();
  console.log("Publishing...");
  const pub = await relay.publish('knowledge', {
    content: "Nexus Prime test communication established.",
    tags: ["#test", "#comms"],
    confidence: 1.0
  });
  console.log("Published ID:", pub.id);

  console.log("Syncing...");
  const msgs = await relay.sync();
  console.log("Current messages in Gist:", msgs);
}

test().catch(console.error);
