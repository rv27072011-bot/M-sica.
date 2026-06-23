// ---------- Temas ----------
const THEMES = [
  { id: "ember",   name: "Brasa",     bg: "#1a1015", surface: "#241419", accent: "#ff6b4a", accent2: "#ffb199", text: "#f5e9e4" },
  { id: "depths",  name: "Profundo",  bg: "#0c1420", surface: "#13202f", accent: "#3ab0ff", accent2: "#8fd9ff", text: "#e7f1fb" },
  { id: "moss",    name: "Musgo",     bg: "#101510", surface: "#19211a", accent: "#7ed957", accent2: "#c2f0a8", text: "#eef5ea" },
  { id: "orchid",  name: "Orquídea",  bg: "#160d1c", surface: "#221329", accent: "#c861f0", accent2: "#eab8ff", text: "#f3e8f7" },
  { id: "amber",   name: "Âmbar",     bg: "#1c1608", surface: "#28200d", accent: "#f0b429", accent2: "#ffe08a", text: "#f7f0dd" },
  { id: "slate",   name: "Ardósia",   bg: "#13151a", surface: "#1d2027", accent: "#9aa6ff", accent2: "#c9d0ff", text: "#eef0f7" },
];

const THEME_STORAGE_KEY = "minhas-musicas:theme";

// ---------- IndexedDB (persistência real dos arquivos de música) ----------
const DB_NAME = "minhas-musicas-db";
const DB_VERSION = 1;
const STORE_TRACKS = "tracks";
const STORE_META = "meta";

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE_TRACKS)) {
        _db.createObjectStore(STORE_TRACKS, { keyPath: "id" });
      }
      if (!_db.objectStoreNames.contains(STORE_META)) {
        _db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveQueueMeta() {
  try {
    await idbPut(STORE_META, { key: "queue", value: queue });
    await idbPut(STORE_META, { key: "currentIndex", value: currentIndex });
  } catch (err) {
    console.error("Erro salvando fila:", err);
  }
}

// ---------- Estado ----------
let tracks = [];
let queue = [];
let currentIndex = -1;
let isPlaying = false;
let repeatMode = "off";
let shuffleOn = false;
let dragIndex = null;

const audio = document.getElementById("audio");
const fileInput = document.getElementById("file-input");
const uploadLabel = document.getElementById("upload-label");
const uploadError = document.getElementById("upload-error");
const trackCountEl = document.getElementById("track-count");
const coverEl = document.getElementById("cover");
const trackNameEl = document.getElementById("track-name");
const trackStatusEl = document.getElementById("track-status");
const seekBar = document.getElementById("seek-bar");
const seekFill = document.getElementById("seek-fill");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const playBtn = document.getElementById("btn-play");
const playIcon = document.getElementById("play-icon");
const prevBtn = document.getElementById("btn-prev");
const nextBtn = document.getElementById("btn-next");
const shuffleBtn = document.getElementById("btn-shuffle");
const repeatBtn = document.getElementById("btn-repeat");
const repeatBadge = document.getElementById("repeat-badge");
const volumeSlider = document.getElementById("volume");
const queueListEl = document.getElementById("queue-list");
const queueEmptyEl = document.getElementById("queue-empty");
const themeToggle = document.getElementById("theme-toggle");
const themeOverlay = document.getElementById("theme-overlay");
const themeClose = document.getElementById("theme-close");
const themeGrid = document.getElementById("theme-grid");

const PLAY_ICON = '<path d="M8 5v14l11-7z"/>';
const PAUSE_ICON = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';

function formatTime(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function coverGradient(seedStr, accent, accent2) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) % 360;
  return `conic-gradient(from ${h}deg, ${accent}, ${accent2}, ${accent})`;
}

function currentTrack() {
  if (currentIndex < 0 || currentIndex >= queue.length) return null;
  const id = queue[currentIndex];
  return tracks.find((t) => t.id === id) || null;
}

function setUploadBusy(busy, label) {
  uploadLabel.style.opacity = busy ? "0.6" : "1";
  uploadLabel.querySelector("span").textContent = label;
}

function applyTheme(theme) {
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.bg);
  root.setProperty("--surface", theme.surface);
  root.setProperty("--accent", theme.accent);
  root.setProperty("--accent2", theme.accent2);
  root.setProperty("--text", theme.text);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme.bg);
  renderQueue();
  renderCover();
}

function loadTheme() {
  const savedId = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = THEMES.find((t) => t.id === savedId) || THEMES[0];
  applyTheme(theme);
  return theme;
}

function saveTheme(theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  applyTheme(theme);
}

function buildThemeGrid() {
  themeGrid.innerHTML = "";
  const currentId = localStorage.getItem(THEME_STORAGE_KEY) || THEMES[0].id;
  THEMES.forEach((theme) => {
    const btn = document.createElement("button");
    btn.className = "theme-swatch";
    btn.style.background = theme.bg;
    btn.style.borderColor = theme.id === currentId ? theme.accent : "transparent";
    btn.innerHTML = `
      <div class="dot" style="background:linear-gradient(135deg, ${theme.accent}, ${theme.accent2})"></div>
      <span style="color:${theme.text}">${theme.name}</span>
    `;
    btn.addEventListener("click", () => {
      saveTheme(theme);
      themeOverlay.classList.add("hidden");
      buildThemeGrid();
    });
    themeGrid.appendChild(btn);
  });
}

themeToggle.addEventListener("click", () => {
  buildThemeGrid();
  themeOverlay.classList.remove("hidden");
});
themeClose.addEventListener("click", () => themeOverlay.classList.add("hidden"));
themeOverlay.addEventListener("click", (e) => {
  if (e.target === themeOverlay) themeOverlay.classList.add("hidden");
});

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus)$/i;

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  await handleFiles(files);
  e.target.value = "";
});

async function handleFiles(files) {
  if (files.length === 0) return;
  const audioFiles = files.filter((f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name));

  if (audioFiles.length === 0) {
    uploadError.textContent = "Nenhum arquivo de áudio reconhecido. Escolha .mp3, .m4a, .wav ou similares.";
    uploadError.style.display = "block";
    return;
  }
  uploadError.style.display = "none";

  setUploadBusy(true, `Salvando 0/${audioFiles.length}...`);

  const newIds = [];
  for (let i = 0; i < audioFiles.length; i++) {
    const file = audioFiles[i];
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const name = file.name.replace(/\.[^/.]+$/, "");

    try {
      await idbPut(STORE_TRACKS, { id, name, blob: file, duration: 0 });
      const url = URL.createObjectURL(file);
      tracks.push({ id, name, blob: file, url, duration: 0 });
      newIds.push(id);
      setUploadBusy(true, `Salvando ${i + 1}/${audioFiles.length}...`);
    } catch (err) {
      console.error("Erro ao salvar música:", err);
    }
  }

  queue = queue.concat(newIds);
  await saveQueueMeta();

  setUploadBusy(false, "Abrir gerenciador de arquivos");
  renderQueue();
  updateTrackCount();

  if (currentIndex === -1 && queue.length > 0) {
    loadTrackAt(0, false);
  }
}

function updateTrackCount() {
  trackCountEl.textContent = `${tracks.length} faixa${tracks.length !== 1 ? "s" : ""}`;
}

function loadTrackAt(index, autoplay = true) {
  const id = queue[index];
  const track = tracks.find((t) => t.id === id);
  if (!track) return;
  currentIndex = index;
  audio.src = track.url;
  audio.volume = parseFloat(volumeSlider.value);
  renderCover();
  renderTrackInfo();
  renderQueue();
  saveQueueMeta();
  if (autoplay) {
    audio.play().then(() => { isPlaying = true; updatePlayIcon(); }).catch(() => {
      isPlaying = false; updatePlayIcon();
    });
  }
}

function renderCover() {
  const track = currentTrack();
  const theme = getActiveThemeValues();
  if (track) {
    coverEl.style.background = coverGradient(track.name, theme.accent, theme.accent2);
    coverEl.innerHTML = "";
  } else {
    coverEl.style.background = "transparent";
    coverEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
}

function getActiveThemeValues() {
  const cs = getComputedStyle(document.documentElement);
  return {
    accent: cs.getPropertyValue("--accent").trim(),
    accent2: cs.getPropertyValue("--accent2").trim(),
  };
}

function renderTrackInfo() {
  const track = currentTrack();
  trackNameEl.textContent = track ? track.name : "Nenhuma música selecionada";
  trackStatusEl.textContent = track ? "Tocando agora" : "Adicione músicas para começar";
}

function updatePlayIcon() {
  playIcon.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
}

function togglePlay() {
  if (!currentTrack()) {
    if (queue.length > 0) loadTrackAt(0, true);
    return;
  }
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
  } else {
    audio.play().then(() => { isPlaying = true; updatePlayIcon(); renderQueue(); }).catch(() => {});
    return;
  }
  updatePlayIcon();
  renderQueue();
}

function goNext() {
  if (queue.length === 0) return;
  if (shuffleOn) {
    let next = Math.floor(Math.random() * queue.length);
    if (queue.length > 1 && next === currentIndex) next = (next + 1) % queue.length;
    loadTrackAt(next, true);
    return;
  }
  const next = currentIndex + 1;
  if (next < queue.length) loadTrackAt(next, true);
  else if (repeatMode === "all") loadTrackAt(0, true);
  else { isPlaying = false; updatePlayIcon(); }
}

function goPrev() {
  if (queue.length === 0) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const prev = currentIndex - 1;
  if (prev >= 0) loadTrackAt(prev, true);
  else loadTrackAt(queue.length - 1, true);
}

audio.addEventListener("ended", () => {
  if (repeatMode === "one") {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  goNext();
});

audio.addEventListener("timeupdate", () => {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  seekFill.style.width = `${pct}%`;
  timeCurrent.textContent = formatTime(audio.currentTime);
});

audio.addEventListener("loadedmetadata", async () => {
  timeTotal.textContent = formatTime(audio.duration);
  const track = currentTrack();
  if (track) {
    track.duration = audio.duration;
    renderQueue();
    try {
      const stored = await idbGet(STORE_TRACKS, track.id);
      if (stored) {
        stored.duration = audio.duration;
        await idbPut(STORE_TRACKS, stored);
      }
    } catch (err) {}
  }
});

seekBar.addEventListener("click", (e) => {
  const rect = seekBar.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  if (audio.duration) audio.currentTime = ratio * audio.duration;
});

playBtn.addEventListener("click", togglePlay);
nextBtn.addEventListener("click", goNext);
prevBtn.addEventListener("click", goPrev);

shuffleBtn.addEventListener("click", () => {
  shuffleOn = !shuffleOn;
  shuffleBtn.classList.toggle("active", shuffleOn);
});

repeatBtn.addEventListener("click", () => {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  repeatBtn.classList.toggle("active", repeatMode !== "off");
  repeatBadge.textContent = repeatMode === "one" ? "1" : "";
});

volumeSlider.addEventListener("input", () => {
  const v = parseFloat(volumeSlider.value);
  audio.volume = v;
  volumeSlider.style.background = `linear-gradient(to right, var(--accent) ${v * 100}%, var(--bg) ${v * 100}%)`;
});

function renderQueue() {
  queueListEl.innerHTML = "";
  const queueTracks = queue.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);

  queueEmptyEl.style.display = queueTracks.length === 0 ? "block" : "none";
  queueListEl.style.display = queueTracks.length === 0 ? "none" : "flex";

  const theme = getActiveThemeValues();

  queueTracks.forEach((track, index) => {
    const li = document.createElement("li");
    li.className = "queue-item" + (index === currentIndex ? " current" : "");
    li.draggable = true;
    li.dataset.index = index;

    const isCurrentlyPlaying = index === currentIndex && isPlaying;

    li.innerHTML = `
      <span class="handle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
      </span>
      <button class="mini-cover" style="background:${coverGradient(track.name, theme.accent, theme.accent2)}" aria-label="Tocar ${track.name}">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${isCurrentlyPlaying ? PAUSE_ICON : PLAY_ICON}</svg>
      </button>
      <div class="item-meta">
        <p class="name" style="${index === currentIndex ? "color:var(--accent)" : ""}">${escapeHtml(track.name)}</p>
        <p class="dur">${track.duration ? formatTime(track.duration) : "—"}</p>
      </div>
      <button class="remove-btn" aria-label="Remover da fila">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    `;

    li.querySelector(".mini-cover").addEventListener("click", () => loadTrackAt(index, true));
    li.querySelector(".item-meta").addEventListener("click", () => loadTrackAt(index, true));
    li.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromQueue(index);
    });

    li.addEventListener("dragstart", () => { dragIndex = index; li.classList.add("dragging"); });
    li.addEventListener("dragend", () => { dragIndex = null; li.classList.remove("dragging"); clearDragOverStyles(); });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      clearDragOverStyles();
      li.classList.add("drag-over");
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragIndex !== null) reorderQueue(dragIndex, index);
      clearDragOverStyles();
    });

    setupTouchDrag(li, index);

    queueListEl.appendChild(li);
  });

  updateTrackCount();
}

function clearDragOverStyles() {
  document.querySelectorAll(".queue-item.drag-over").forEach((el) => el.classList.remove("drag-over"));
}

function reorderQueue(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const moved = queue.splice(fromIndex, 1)[0];
  queue.splice(toIndex, 0, moved);

  if (currentIndex === fromIndex) currentIndex = toIndex;
  else if (fromIndex < currentIndex && toIndex >= currentIndex) currentIndex -= 1;
  else if (fromIndex > currentIndex && toIndex <= currentIndex) currentIndex += 1;

  renderQueue();
  saveQueueMeta();
}

async function removeFromQueue(index) {
  const removedId = queue[index];
  queue.splice(index, 1);
  tracks = tracks.filter((t) => t.id !== removedId);

  if (index === currentIndex) {
    audio.pause();
    isPlaying = false;
    currentIndex = -1;
    renderCover();
    renderTrackInfo();
    updatePlayIcon();
  } else if (index < currentIndex) {
    currentIndex -= 1;
  }
  renderQueue();

  try {
    await idbDelete(STORE_TRACKS, removedId);
    await saveQueueMeta();
  } catch (err) {
    console.error("Erro removendo música salva:", err);
  }
}

function setupTouchDrag(li, index) {
  const handle = li.querySelector(".handle");
  let startY = 0;
  let dragging = false;

  handle.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    dragging = true;
    dragIndex = parseInt(li.dataset.index, 10);
    li.classList.add("dragging");
    li.style.position = "relative";
    li.style.zIndex = "10";
  }, { passive: true });

  handle.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const touchY = e.touches[0].clientY;
    li.style.transform = `translateY(${touchY - startY}px)`;

    const items = Array.from(queueListEl.children);
    const overEl = items.find((el) => {
      const rect = el.getBoundingClientRect();
      return touchY >= rect.top && touchY <= rect.bottom;
    });
    clearDragOverStyles();
    if (overEl && overEl !== li) overEl.classList.add("drag-over");
  }, { passive: true });

  handle.addEventListener("touchend", (e) => {
    if (!dragging) return;
    dragging = false;
    li.style.transform = "";
    li.style.zIndex = "";
    li.classList.remove("dragging");

    const touchY = e.changedTouches[0].clientY;
    const items = Array.from(queueListEl.children);
    const overEl = items.find((el) => {
      const rect = el.getBoundingClientRect();
      return touchY >= rect.top && touchY <= rect.bottom;
    });
    clearDragOverStyles();
    if (overEl) {
      const toIndex = parseInt(overEl.dataset.index, 10);
      if (dragIndex !== null) reorderQueue(dragIndex, toIndex);
    }
    dragIndex = null;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadPersistedData() {
  try {
    db = await openDB();
  } catch (err) {
    console.error("IndexedDB indisponível:", err);
    return;
  }

  try {
    const [storedTracks, queueMeta, indexMeta] = await Promise.all([
      idbGetAll(STORE_TRACKS),
      idbGet(STORE_META, "queue"),
      idbGet(STORE_META, "currentIndex"),
    ]);

    tracks = storedTracks.map((t) => ({
      id: t.id,
      name: t.name,
      blob: t.blob,
      url: URL.createObjectURL(t.blob),
      duration: t.duration || 0,
    }));

    const savedQueue = (queueMeta && queueMeta.value) || [];
    queue = savedQueue.filter((id) => tracks.some((t) => t.id === id));
    tracks.forEach((t) => { if (!queue.includes(t.id)) queue.push(t.id); });

    const savedIndex = (indexMeta && typeof indexMeta.value === "number") ? indexMeta.value : -1;
    currentIndex = savedIndex >= 0 && savedIndex < queue.length ? savedIndex : -1;

    renderQueue();
    updateTr
