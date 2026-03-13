/**
 * Хранилище состояния бота.
 * На Render бесплатный диск эфемерный — при деплое данные теряются.
 *
 * Варианты (по приоритету):
 * 1. GitHub Gist — без регистрации в MongoDB. Задайте GITHUB_GIST_TOKEN и GITHUB_GIST_ID.
 * 2. MongoDB Atlas — задайте MONGODB_URI.
 * 3. Локальный data.json — если ничего не задано (для разработки).
 */
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");
const DEFAULT_DATA = {
  chatId: null,
  family: [],
  dutyIndex: 0,
  stats: {},
  doneToday: false,
  fails: {},
  history: [],
  hardcore: false,
  dutyStatus: "none",
  daySkipped: false,
  memberIds: {},
  adminId: null,
  tasks: null,
};

const GIST_FILENAME = "family_bot_data.json";

function useGist() {
  return !!(process.env.GITHUB_GIST_TOKEN && process.env.GITHUB_GIST_ID);
}

async function gistFetch(method, path, body) {
  const token = process.env.GITHUB_GIST_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gist API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function gistLoad() {
  const id = process.env.GITHUB_GIST_ID;
  const gist = await gistFetch("GET", `/gists/${id}`);
  const file = gist.files[GIST_FILENAME];
  if (!file || !file.content) return { ...DEFAULT_DATA };
  try {
    return { ...DEFAULT_DATA, ...JSON.parse(file.content) };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

async function gistSave(data) {
  const id = process.env.GITHUB_GIST_ID;
  await gistFetch("PATCH", `/gists/${id}`, {
    files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
  });
}

// --- MongoDB ---
let client = null;
let collection = null;
const STATE_ID = "default";

async function connectMongo() {
  if (client) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const { MongoClient } = require("mongodb");
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db(new URL(uri).pathname.slice(1) || "family_bot");
  collection = db.collection("state");
}

function useMongo() {
  return !!process.env.MONGODB_URI;
}

async function mongoLoad() {
  await connectMongo();
  const doc = await collection.findOne({ _id: STATE_ID });
  if (!doc) return { ...DEFAULT_DATA };
  const { _id, ...rest } = doc;
  return { ...DEFAULT_DATA, ...rest };
}

async function mongoSave(data) {
  await connectMongo();
  const doc = { _id: STATE_ID, ...data };
  await collection.replaceOne({ _id: STATE_ID }, doc, { upsert: true });
}

// --- File ---
function fileLoad() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return { ...DEFAULT_DATA, ...JSON.parse(raw) };
}

function fileSave(data) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/**
 * Загрузить состояние.
 * @returns {Promise<object>}
 */
async function load() {
  if (useGist()) return gistLoad();
  if (useMongo()) return mongoLoad();
  return Promise.resolve(fileLoad());
}

/**
 * Сохранить состояние.
 * @param {object} data
 */
async function save(data) {
  if (useGist()) return gistSave(data);
  if (useMongo()) return mongoSave(data);
  return Promise.resolve(fileSave(data));
}

module.exports = { load, save, DEFAULT_DATA };
