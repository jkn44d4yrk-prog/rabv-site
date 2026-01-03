document.addEventListener("DOMContentLoaded", () => {

  // =================== SOLO TÚ ===================
  const ALLOWED_EMAILS = [
    "robertobacallado@gmail.com"
  ].map(e => e.trim().toLowerCase()).filter(Boolean);

  function isAuthorized(user) {
    const userEmail = (user?.email || "").trim().toLowerCase();
    return userEmail && ALLOWED_EMAILS.includes(userEmail);
  }
  // ==============================================

  // ================= DOM =================
  const loginEl = document.getElementById("login");
  const menuEl = document.getElementById("menu");
  const testEl = document.getElementById("test");
  const questionEl = document.getElementById("question");
  const optionsEl = document.getElementById("options");
  const nextBtn = document.getElementById("nextBtn");
  const blockMsgEl = document.getElementById("blockMsg");

  const backToMenuBtn = document.getElementById("backToMenuBtn");
  const logoutBtnTest = document.getElementById("logoutBtnTest");

  const emailEl = document.getElementById("email");
  const passwordEl = document.getElementById("password");
  const loginErrorEl = document.getElementById("loginError");

  // ================= CONFIG =================
  const BLOCK_SIZE = 10;
  const MOST_FAILED_COUNT = 40; // ✅ TOP 40 global (o menos si no hay)

  // ================= STATE =================
  let state = { history: [], attempts: {} };
  let currentBlock = [];
  let currentIndex = 0;
  let currentSessionTitle = "BLOQUE";

  // ================= EXTRA STATE FOR ADVANCED FEATURES =================
  // currentStartIndex tracks the starting index of the current block (used for resume)
  let currentStartIndex = 0;
  // Set of starred question IDs loaded from localStorage
  let starred = new Set();
  try {
    const storedStar = JSON.parse(localStorage.getItem("starredIds") || "[]");
    if (Array.isArray(storedStar)) {
      starred = new Set(storedStar);
    }
  } catch (_) {
    // ignore parse errors
  }

  // ================= UI HELPERS =================
  function showLoginError(msg) {
    if (!loginErrorEl) return alert(msg);
    loginErrorEl.style.display = "block";
    loginErrorEl.textContent = msg;
  }

  function clearLoginError() {
    if (!loginErrorEl) return;
    loginErrorEl.style.display = "none";
    loginErrorEl.textContent = "";
  }

  function showLoginScreen() {
    loginEl.style.display = "block";
    testEl.style.display = "none";
    menuEl.style.display = "none";
    blockMsgEl.style.display = "none";
  }

  // ================= HELPERS =================
  function normalizeState(loaded) {
    const safe = loaded && typeof loaded === "object" ? loaded : {};
    return {
      history: Array.isArray(safe.history) ? safe.history : [],
      attempts: safe.attempts && typeof safe.attempts === "object" ? safe.attempts : {},
    };
  }

  function getFirstAttemptsMap() {
    const first = new Map();
    for (const h of state.history) {
      if (!first.has(h.questionId)) first.set(h.questionId, h);
    }
    return first;
  }

  function getBlockQuestions(startIndex) {
    return questions.slice(startIndex, startIndex + BLOCK_SIZE);
  }

  function getQuestionsForMode(startIndex, mode) {
    const blockQs = getBlockQuestions(startIndex);
    const first = getFirstAttemptsMap();

    if (mode === "NORMAL") return blockQs;

    if (mode === "FAILED") {
      return blockQs.filter(q => {
        const a = first.get(q.id);
        return a && a.selected !== a.correct;
      });
    }

    if (mode === "FIRST_OK") {
      return blockQs.filter(q => {
        const a = first.get(q.id);
        return a && a.selected === a.correct;
      });
    }

    return [];
  }

  function resetBlockData(startIndex) {
    const blockQuestions = getBlockQuestions(startIndex);
    const ids = new Set(blockQuestions.map(q => q.id));

    state.history = state.history.filter(h => !ids.has(h.questionId));
    for (const id of ids) delete state.attempts[id];
  }

  // ================= STATS & RESUME HELPERS =================
  // Update the small statistics panel in the menu (answered, correct, incorrect, dominated)
  function updateStatsPanel() {
    const panel = document.getElementById("statsPanel");
    if (!panel) return;
    const first = getFirstAttemptsMap();
    let totalAnswered = first.size;
    let totalCorrect = 0;
    let totalIncorrect = 0;
    for (const q of questions) {
      const a = first.get(q.id);
      if (!a) continue;
      if (a.selected === a.correct) totalCorrect++;
      else totalIncorrect++;
    }
    // Dominadas: preguntas con 3 o más intentos (aprox. dominadas)
    let dominated = 0;
    for (const id in state.attempts) {
      const count = state.attempts[id];
      if (count >= 3) dominated++;
    }
    panel.innerHTML =
      `<span>Respondidas: ${totalAnswered}/${questions.length}</span>` +
      `<span>Aciertos: ${totalCorrect}</span>` +
      `<span>Fallos: ${totalIncorrect}</span>` +
      `<span>Dominadas: ${dominated}</span>`;
  }

  // Toggle a question as starred/unstarred and persist to localStorage
  function toggleStar(qId) {
    if (starred.has(qId)) {
      starred.delete(qId);
    } else {
      starred.add(qId);
    }
    // Persist starred IDs
    try {
      localStorage.setItem("starredIds", JSON.stringify(Array.from(starred)));
    } catch (_) {}
    updateReviewStarBtn();
  }

  // Update the "Repasar marcadas" button text and state
  function updateReviewStarBtn() {
    const btn = document.getElementById("reviewStarBtn");
    if (!btn) return;
    const n = starred.size;
    btn.textContent = `Repasar marcadas (${n})`;
    btn.disabled = n === 0;
  }

  // Store the current question ID for resume purposes
  function updateResumeInfo(questionId) {
    if (!questionId) return;
    try {
      localStorage.setItem("resumeQuestionId", String(questionId));
    } catch (_) {}
  }

  // Resume where the user left off
  function resume() {
    const resumeId = localStorage.getItem("resumeQuestionId");
    if (!resumeId) return;
    const idx = questions.findIndex(q => String(q.id) === String(resumeId));
    if (idx < 0) return;
    const startIndex = Math.floor(idx / BLOCK_SIZE) * BLOCK_SIZE;
    const localIndex = idx - startIndex;
    // Start a normal block and then jump to the stored question
    startBlock(startIndex, "NORMAL");
    currentIndex = localIndex;
    loadQuestion();
  }

  // Search for a block or question based on input value
  function handleSearch() {
    const input = document.getElementById("searchInput");
    if (!input) return;
    const val = (input.value || "").trim();
    if (!val) return;
    // Try numeric first
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      if (num >= 1 && num <= questions.length) {
        // go to specific question number
        const idx = num - 1;
        const startIndex = Math.floor(idx / BLOCK_SIZE) * BLOCK_SIZE;
        const localIndex = idx - startIndex;
        startBlock(startIndex, "NORMAL");
        currentIndex = localIndex;
        loadQuestion();
        return;
      }
      const numBlocks = Math.ceil(questions.length / BLOCK_SIZE);
      if (num >= 1 && num <= numBlocks) {
        // go to specific block number
        const startIndex = (num - 1) * BLOCK_SIZE;
        startBlock(startIndex, "NORMAL");
        return;
      }
    }
    // Fallback: search by substring in the question text
    const lc = val.toLowerCase();
    const index = questions.findIndex(q => q.question && q.question.toLowerCase().includes(lc));
    if (index >= 0) {
      const startIndex = Math.floor(index / BLOCK_SIZE) * BLOCK_SIZE;
      const localIndex = index - startIndex;
      startBlock(startIndex, "NORMAL");
      currentIndex = localIndex;
      loadQuestion();
    } else {
      alert("No se encontró ningún bloque o pregunta que coincida.");
    }
  }

  // Start a random exam session of 40 questions
  function startExam() {
    const count = Math.min(40, questions.length);
    const idxs = Array.from({ length: questions.length }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const selected = idxs.slice(0, count).map(i => questions[i]);
    startCustomQuestions(selected, "EXAMEN");
  }

  // ✅ Top N preguntas más falladas (global, contando todos los intentos)
  //    Si hay menos de N, devuelve las que haya.
  function getMostFailedQuestionsTopN(n) {
    const failCount = new Map(); // questionId -> nº fallos

    for (const h of state.history) {
      if (!h || !h.questionId) continue;
      if (h.selected !== h.correct) {
        failCount.set(h.questionId, (failCount.get(h.questionId) || 0) + 1);
      }
    }

    const sortedIds = Array.from(failCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const byId = new Map(questions.map(q => [q.id, q]));
    const top = [];

    for (const id of sortedIds) {
      const q = byId.get(id);
      if (q) top.push(q);
      if (top.length >= n) break;
    }

    return top;
  }

  // ================= FIRESTORE =================
  async function saveProgress(user) {
    try { await db.collection("progress").doc(user.uid).set(state); }
    catch (e) { console.error("Error saving progress:", e); }
  }

  async function loadProgress(user) {
    try {
      const doc = await db.collection("progress").doc(user.uid).get();
      state = doc.exists ? normalizeState(doc.data()) : normalizeState(state);
    } catch (e) {
      console.error("Error loading progress:", e);
      if (e?.code === "permission-denied") {
        await auth.signOut();
        showLoginScreen();
        showLoginError("No autorizado (reglas Firestore). Revisa el email de la regla.");
        return;
      }
      state = normalizeState(state);
    }
  }

  // ================= AUTH =================
  async function ensurePersistence() {
    const tries = [
      firebase.auth.Auth.Persistence.LOCAL,
      firebase.auth.Auth.Persistence.SESSION,
      firebase.auth.Auth.Persistence.NONE,
    ];
    for (const p of tries) {
      try { await auth.setPersistence(p); return; } catch (_) {}
    }
  }

  async function logout() {
    try { await auth.signOut(); } catch (e) { console.error(e); }
  }

  async function login() {
    clearLoginError();

    const email = (emailEl?.value || "").trim();
    const password = (passwordEl?.value || "");

    try {
      await ensurePersistence();
      const cred = await auth.signInWithEmailAndPassword(email, password);

      if (!isAuthorized(cred.user)) {
        await auth.signOut();
        showLoginError("No autorizado.");
      }
    } catch (e) {
      console.error(e);
      showLoginError(e.message || "No se pudo iniciar sesión.");
    }
  }

  window.login = login;

  if (logoutBtnTest) logoutBtnTest.onclick = logout;

  [emailEl, passwordEl].filter(Boolean).forEach(el => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") login();
    });
  });

  // ================= MENU =================
  function renderMenuTopbar() {
    const top = document.createElement("div");
    top.className = "menu-topbar";

    const h2 = document.createElement("h2");
    h2.textContent = "Selecciona un bloque";

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logoutBtn";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Cerrar sesión";
    logoutBtn.onclick = logout;

    top.appendChild(h2);
    top.appendChild(logoutBtn);
    return top;
  }

  function renderMenuFooter() {
    const footer = document.createElement("div");
    footer.className = "menu-footer";

    const mostFailed = getMostFailedQuestionsTopN(MOST_FAILED_COUNT);

    const btn = document.createElement("button");
    btn.id = "repeatMostFailedBtn";
    btn.type = "button";

    // Texto dinámico: "Top 40" pero si hay menos, muestra cuántas hay
    const n = mostFailed.length;
    btn.textContent = n > 0
      ? `Repetir más falladas (${n} pregunta${n === 1 ? "" : "s"})`
      : `Repetir más falladas (${MOST_FAILED_COUNT})`;

    btn.disabled = n === 0;

    btn.onclick = () => {
      const qs = getMostFailedQuestionsTopN(MOST_FAILED_COUNT);
      if (qs.length === 0) {
        alert("Todavía no hay fallos registrados.");
        return;
      }
      startCustomQuestions(qs, "REPASO");
    };

    footer.appendChild(btn);
    return footer;
  }

  function showMenu() {
    loginEl.style.display = "none";
    testEl.style.display = "none";
    blockMsgEl.style.display = "none";
    menuEl.style.display = "block";

    menuEl.innerHTML = "";
    menuEl.appendChild(renderMenuTopbar());

    // ===== Panel de estadísticas =====
    const statsDiv = document.createElement("div");
    statsDiv.id = "statsPanel";
    statsDiv.className = "stats-panel";
    menuEl.appendChild(statsDiv);
    updateStatsPanel();

    // ===== Botón para continuar donde se dejó =====
    const resumeId = localStorage.getItem("resumeQuestionId");
    if (resumeId) {
      const resumeBtn = document.createElement("button");
      resumeBtn.id = "resumeBtn";
      resumeBtn.type = "button";
      resumeBtn.textContent = "Continuar donde lo dejé";
      resumeBtn.style.marginBottom = "16px";
      resumeBtn.onclick = resume;
      menuEl.appendChild(resumeBtn);
    }

    // ===== Buscador de bloques/preguntas =====
    const searchDiv = document.createElement("div");
    searchDiv.className = "search-container";
    const searchInput = document.createElement("input");
    searchInput.id = "searchInput";
    searchInput.type = "text";
    searchInput.placeholder = "Buscar bloque o pregunta…";
    const searchBtn = document.createElement("button");
    searchBtn.id = "searchBtn";
    searchBtn.type = "button";
    searchBtn.textContent = "Ir";
    searchBtn.onclick = handleSearch;
    searchDiv.appendChild(searchInput);
    searchDiv.appendChild(searchBtn);
    menuEl.appendChild(searchDiv);

    // ===== Acciones: examen y marcadas =====
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "menu-actions";
    const examBtn = document.createElement("button");
    examBtn.id = "examBtn";
    examBtn.type = "button";
    examBtn.textContent = "Simulacro (40)";
    examBtn.onclick = startExam;
    actionsDiv.appendChild(examBtn);
    const reviewStarBtn = document.createElement("button");
    reviewStarBtn.id = "reviewStarBtn";
    reviewStarBtn.type = "button";
    reviewStarBtn.textContent = "Repasar marcadas";
    reviewStarBtn.onclick = () => {
      const list = questions.filter(q => starred.has(q.id));
      if (list.length === 0) {
        alert("No hay preguntas marcadas.");
        return;
      }
      startCustomQuestions(list, "MARCADAS");
    };
    actionsDiv.appendChild(reviewStarBtn);
    menuEl.appendChild(actionsDiv);

    const numBlocks = Math.ceil(questions.length / BLOCK_SIZE);
    const first = getFirstAttemptsMap();

    for (let i = 0; i < numBlocks; i++) {
      const startIndex = i * BLOCK_SIZE;
      const start = startIndex + 1;
      const end = Math.min(startIndex + BLOCK_SIZE, questions.length);

      const blockQuestions = getBlockQuestions(startIndex);

      let correctCount = 0;
      let failedCount = 0;
      let answeredCount = 0;

      for (const q of blockQuestions) {
        const a = first.get(q.id);
        if (!a) continue;
        answeredCount++;
        if (a.selected === a.correct) correctCount++;
        else failedCount++;
      }

      const percent = Math.round((correctCount / blockQuestions.length) * 100);

      const row = document.createElement("div");
      row.className = "block-row";

      const mainBtn = document.createElement("button");
      mainBtn.className = "block-main";
      mainBtn.textContent = `${start}-${end}`;
      mainBtn.onclick = () => startBlock(startIndex, "NORMAL");

      const percentEl = document.createElement("span");
      percentEl.className = "block-percent";
      percentEl.textContent = `${correctCount}/${blockQuestions.length} (${percent}%)`;

      if (answeredCount === 0) percentEl.classList.add("pct-none");
      else if (percent >= 80) percentEl.classList.add("pct-good");
      else if (percent >= 50) percentEl.classList.add("pct-mid");
      else percentEl.classList.add("pct-bad");

      const failedBtn = document.createElement("button");
      failedBtn.className = "block-mini";
      failedBtn.textContent = `Rehacer falladas (${failedCount})`;
      failedBtn.disabled = failedCount === 0;
      failedBtn.onclick = () => startBlock(startIndex, "FAILED");

      const firstOkBtn = document.createElement("button");
      firstOkBtn.className = "block-mini";
      firstOkBtn.textContent = `Rehacer acertadas (${correctCount})`;
      firstOkBtn.disabled = correctCount === 0;
      firstOkBtn.onclick = () => startBlock(startIndex, "FIRST_OK");

      const resetBtn = document.createElement("button");
      resetBtn.className = "block-reset";
      resetBtn.textContent = "Reset";
      resetBtn.disabled = answeredCount === 0;
      resetBtn.onclick = async () => {
        const ok = confirm(`¿Resetear el bloque ${start}-${end} a 0 y empezarlo de nuevo?`);
        if (!ok) return;

        resetBlockData(startIndex);

        const u = auth.currentUser;
        if (u) await saveProgress(u);

        startBlock(startIndex, "NORMAL");
      };

      row.appendChild(mainBtn);
      row.appendChild(percentEl);
      row.appendChild(failedBtn);
      row.appendChild(firstOkBtn);
      row.appendChild(resetBtn);

      menuEl.appendChild(row);
    }

    menuEl.appendChild(renderMenuFooter());

    // Actualiza panel de estadísticas y botón de marcadas según el estado actual
    updateStatsPanel();
    updateReviewStarBtn();
  }

  // ================= SESIONES DE PREGUNTAS =================
  function startBlock(startIndex, mode) {
    currentSessionTitle = "BLOQUE";
    currentStartIndex = startIndex;
    menuEl.style.display = "none";
    testEl.style.display = "block";
    blockMsgEl.style.display = "none";
    currentIndex = 0;

    currentBlock = getQuestionsForMode(startIndex, mode);

    if (currentBlock.length === 0) {
      alert("No hay preguntas para este bloque.");
      showMenu();
      return;
    }

    loadQuestion();
  }

  function startCustomQuestions(qs, title) {
    currentSessionTitle = title || "REPASO";
    // custom sessions do not belong to a fixed block
    currentStartIndex = -1;
    menuEl.style.display = "none";
    testEl.style.display = "block";
    blockMsgEl.style.display = "none";
    currentIndex = 0;

    currentBlock = Array.isArray(qs) ? qs.slice() : [];

    if (currentBlock.length === 0) {
      alert("No hay preguntas para repasar.");
      showMenu();
      return;
    }

    loadQuestion();
  }

  function loadQuestion() {
    const q = currentBlock[currentIndex];
    // Render question text and star button
    questionEl.textContent = "";
    const qSpan = document.createElement("span");
    qSpan.textContent = q.question;
    questionEl.appendChild(qSpan);
    // star button
    const starBtn = document.createElement("button");
    starBtn.className = "star-btn";
    const isStarred = starred.has(q.id);
    starBtn.innerHTML = isStarred ? "★" : "☆";
    if (isStarred) starBtn.classList.add("active");
    starBtn.onclick = () => {
      toggleStar(q.id);
      const active = starred.has(q.id);
      starBtn.innerHTML = active ? "★" : "☆";
      if (active) starBtn.classList.add("active");
      else starBtn.classList.remove("active");
    };
    questionEl.appendChild(starBtn);

    // Update resume info
    updateResumeInfo(q.id);

    optionsEl.innerHTML = "";
    nextBtn.disabled = true;

    Object.entries(q.options).forEach(([letter, text]) => {
      const btn = document.createElement("button");
      btn.dataset.letter = letter;
      btn.textContent = `${letter}) ${text}`;
      btn.onclick = (e) => answer(e, letter, q.correct, q.id);
      optionsEl.appendChild(btn);
    });
  }

  function answer(event, selected, correct, qId) {
    const buttons = optionsEl.querySelectorAll("button");
    buttons.forEach(btn => btn.disabled = true);

    buttons.forEach(btn => {
      if (btn.dataset.letter === correct) btn.classList.add("correct");
    });

    if (selected === correct) event.target.classList.add("correct");
    else event.target.classList.add("incorrect");

    state.history.push({
      questionId: qId,
      selected,
      correct,
      date: new Date().toISOString()
    });

    state.attempts[qId] = (state.attempts[qId] || 0) + 1;
    nextBtn.disabled = false;
  }

  if (backToMenuBtn) {
    backToMenuBtn.onclick = async () => {
      const user = auth.currentUser;
      if (user) await saveProgress(user);
      showMenu();
    };
  }

  nextBtn.onclick = async () => {
    currentIndex++;

    if (currentIndex >= currentBlock.length) {
      testEl.style.display = "none";
      blockMsgEl.style.display = "block";
      blockMsgEl.innerHTML = `
        <h2>${currentSessionTitle} COMPLETADO 🎉</h2>
        <button id="continueBtn">Volver al menú</button>
      `;
      document.getElementById("continueBtn").onclick = showMenu;
    } else {
      loadQuestion();
    }

    const user = auth.currentUser;
    if (user) await saveProgress(user);

    // After progress save, update stats panel and review-star button (if visible)
    updateStatsPanel();
    updateReviewStarBtn();
  };

  // ================= AUTH STATE =================
  auth.onAuthStateChanged(async user => {
    if (!user) {
      showLoginScreen();
      return;
    }

    if (!isAuthorized(user)) {
      await auth.signOut();
      showLoginScreen();
      showLoginError("No autorizado.");
      return;
    }

    loginEl.style.display = "none";
    await loadProgress(user);
    showMenu();
  });

  // ================= KEYBOARD SHORTCUTS =================
  // Atajos de teclado globales:
  // N → siguiente pregunta, B → volver al menú,
  // R → repetir más falladas, C → continuar donde lo dejaste
  document.addEventListener("keydown", (ev) => {
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const key = ev.key.toLowerCase();
    if (key === "n") {
      if (nextBtn && !nextBtn.disabled) nextBtn.click();
    } else if (key === "b") {
      if (backToMenuBtn) backToMenuBtn.click();
    } else if (key === "r") {
      const btn = document.getElementById("repeatMostFailedBtn");
      if (btn && !btn.disabled) btn.click();
    } else if (key === "c") {
      const btn = document.getElementById("resumeBtn");
      if (btn) btn.click();
    }
  });

});
