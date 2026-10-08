// `npm start`. node:sqlite first: a Node.js without it would fail with a message that doesn't say what to do.
try {
  await import('node:sqlite');
} catch {
  console.error(
    `Dice Roguelife standalone needs Node.js 22.13 or later; this is ${process.version}. https://nodejs.org/`,
  );
  process.exit(1);
}
const { adoptOldData, appHome, checkUpdate, startServer } = await import('./server.js');
let server;
try {
  for (const old of adoptOldData()) console.log(`Copied ${old} to ${appHome()}. You can delete the old copy.`);
  server = await startServer();
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port ${e.port} is in use: is the game already running?` : e.message);
  console.error(`Settings and data: ${appHome()}`);
  process.exit(1);
}
console.log(`Dice Roguelife (standalone): http://localhost:${server.address().port}`);
console.log(`Saves, pictures and the AI connection: ${server.dataPath}`);
// Ctrl+C: the store closes with the server, so nothing is left half-written
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
const update = await checkUpdate();
if (update.newer) console.log(`A newer version, v${update.latest}, is out: ${update.url}`);
