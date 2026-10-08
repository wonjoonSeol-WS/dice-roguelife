# Dice Roguelife standalone (optional add-on)

> **The main way to play is the Claude artifact** (see the [README](https://github.com/wonjoonSeol-WS/dice-roguelife#readme)): no install, no API key.
> This add-on is for people who would rather run the game on their own computer with an API key or a local model.
> It is **community-maintained**, and the provider presets are not tested against every paid service.

## What you need

- [Node.js](https://nodejs.org/) 22.13 or later
- An API key from an AI provider, or a model running on your computer (Ollama, LM Studio, llama.cpp, vLLM)

## Start

Download `dice-roguelife-standalone-v….zip` from the [latest release](https://github.com/wonjoonSeol-WS/dice-roguelife/releases/latest) (not `dice-roguelife.html`, which is
the artifact page) and unzip it. In the unzipped folder (the one with `package.json`), run:

```sh
npm start
```

There is nothing to install: the page comes built. If Windows PowerShell says running scripts is disabled, run
`node standalone/start.js` instead. To run it from a copy of the repository instead (to change the
code), use `npm ci`, then `npm start`, which builds the page from the source at every start.

Open **http://localhost:3000**, then **⚙ Settings → AI connection**: choose a provider, paste your API key (not
needed for local models), enter the provider's exact model ID, and **Save connection**. **Test connection** makes one
API call. Keep the server running while you play.

## Providers

Presets for OpenAI, Anthropic, Google Gemini, Azure OpenAI and Perplexity (each in its own request format), plus
OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, DeepInfra, Cerebras, NVIDIA NIM and Hugging Face
(OpenAI-compatible), and the local servers Ollama, LM Studio, llama.cpp and vLLM. **Custom** takes any
OpenAI-compatible endpoint. Remote endpoints must use HTTPS; local servers can use HTTP on localhost.

Use a model that follows JSON instructions well. Turn on JSON mode only if the model supports it, and turn off
streaming if the endpoint doesn't support it. **Fast** in ⚙ Settings uses the optional summary model; Standard and
Deep use the narration model.

For a local model, use the sampling settings its makers recommend: at llama.cpp's defaults a quantized model can get
stuck repeating itself until the reply hits the output limit. For Qwen models, start llama.cpp with
`--temp 0.7 --top-p 0.8 --top-k 20 --presence-penalty 1.0`, and `--reasoning-budget 0` to skip the thinking step. With
Qwen3.8-27B (Q4_K_M) on an RTX 4090, a new life takes about 30 seconds and a turn 15 to 20.

You can keep several connections as **profiles** (say, a paid model and a local one): pick **+ New profile** in the
**Profile** list, name it and save. Choosing a profile in the list switches the game to it at once.

Logins that reuse a chat subscription (Claude Pro/Max through Claude Code, ChatGPT through Codex, Gemini CLI) are not
supported: their providers' terms don't allow it in other apps. If you have a Claude subscription, play the artifact.

## Costs and keys

API calls are billed to your API account. Like the artifact, the game makes extra calls for summaries and Life
Reviews, and a reply it can't read is retried up to twice. Network retries for rate limits and server errors are off
by default (⚙ Settings). The usage line in Settings shows the tokens providers report.

Your connection profiles and their keys are kept in `connection.json` in the data folder (below), **unencrypted**,
so every browser on this computer uses them. The server adds the key when it calls the provider: the page never
gets it back, and it never goes into saves or exports. Saving a profile with another endpoint and no new key drops its
old key.

## Saves and images

Saves, images, the AI connection and `config.json` are kept on this computer in your user's app-data folder, not in the
app's folder and not in the browser:

- Windows: `%LOCALAPPDATA%\dice-roguelife`
- macOS: `~/Library/Application Support/dice-roguelife`
- Linux: `~/.local/share/dice-roguelife`

`npm start` prints the folder in use. Clearing browser data doesn't touch it, any browser on this computer sees the same
saves, and a new version of the app finds them by itself. To back up, stop the server and copy the folder. To keep the
data somewhere else, set `dataDir` in `config.json` (below), or start with the environment variable
`DICE_ROGUELIFE_HOME` set to another folder.

Moving from the artifact: export your saves (Saves → Save file) and your images (Images → Export pack) there, then
import them here. Pictures pinned to past turns don't carry over; portraits for new turns do.

## Playing on your phone (Tailscale)

The server only answers this computer. To play from your phone as well, install [Tailscale](https://tailscale.com/) on
the computer and the phone with the same account, then on the computer run `tailscale serve --bg 3000` (allow HTTPS
when it asks). It prints this computer's address, such as `https://my-pc.tail1234.ts.net`. Add that name in **⚙ Settings →
Server settings** (or to `hosts` in `config.json`, below) and open the address on the phone.

Only devices on your Tailscale account can reach it. Don't play the same save on two devices at the same time.

## Server settings (config.json)

The server reads an optional `config.json` in the app-data folder (above). Edit it in **⚙ Settings → Server
settings**, or by hand. Every field can be left out:

```json
{
  "port": 3000,
  "dataDir": "D:/dice-roguelife",
  "hosts": ["my-pc.tail1234.ts.net"]
}
```

- `port`: the port the game is served on (3000).
- `dataDir`: where saves, images and the AI connection are kept (the folder `config.json` is in). A relative path
  starts from that folder.
- `hosts`: other names this server answers to, for Tailscale (above). These apply at once; a new port or folder
  applies the next time you run `npm start`.

The AI connection itself is chosen in ⚙ Settings and kept in the data folder (`connection.json`).

## Updating

`npm start` and **⚙ Settings → Check for updates** tell you when a new version is out. Stop the server, unzip the new
`dice-roguelife-standalone-v….zip` anywhere and run `npm start` there. Your data isn't in the app's folder, so there is
nothing to copy; delete the old folder whenever you like. From a copy of the repository: `git pull`, `npm ci`,
`npm start`.

Versions before 2.9 kept `config.json` and the data in the app's own `standalone/` folder. The first start of a newer
version copies them to the app-data folder by itself and says so; the old copy can then go.

## How it fits in

The game reaches its platform only through a host adapter (`src/js/host.js`). This folder adds one more, without
changing the artifact:

| File                         | Role                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `start.js`                   | `npm start`: checks the Node.js version, starts the server, says where the data is and whether a newer version is out          |
| `server.js`                  | The local server on 127.0.0.1: serves the page, the storage API, the relay and the update check; finds the app-data folder     |
| `page.js`, `page.html`       | The page: built from the source at start in a copy of the repository, shipped built (`page.html`) in the download              |
| `store.js`                   | Documents in SQLite (Node's built-in `node:sqlite`) with memDB's behavior (`src/js/db.js`), images as files, the AI connection |
| `relay.js`                   | Turns a narration request into each provider's format and streams the reply back                                               |
| `client/main.js`             | The page's entry: the host adapter, then the game (`src/js/main.js`)                                                           |
| `client/host.js`             | The host adapter, joined with `registerHost`: db, assets, sample, user and downloads over the local server                     |
| `client/net.js`              | Requests to the local server with its token                                                                                    |
| `client/providers.js`        | Presets, the page's copy of the connection, and the `sample` capability                                                        |
| `client/settings.js`         | The AI connection and Server settings panels (the host's `bindSettings`), update steps, the setup banner                       |
| `client/i18n.js`, `locales/` | The add-on's own Korean and Japanese text (`tr()`), on top of the game's catalogs                                              |
| `client/standalone.css`      | Its styles, added to the standalone page only                                                                                  |
| `lines.js`                   | Reads a streamed body line by line, for the relay and the page                                                                 |

The artifact build (`npm run build`) contains none of this. The only lines in the game for it are `registerHost` in
`src/js/host.js` and the optional `bindSettings` call in `src/js/settings-sheet.js`.

The page carries a token made for each server start; storage and relay requests must send it, and pictures need the
cookie the page sets. The server answers only `localhost` and `127.0.0.1` on its own port, and the names in `hosts`.

## Tests

In a copy of the repository:

```sh
npm run test:standalone   # relay, storage and translation checks, then the page in a browser with a mocked provider
```

These are separate from `npm test`, which is the game's release check. Install the test browser once with
`npx playwright install chromium`.
