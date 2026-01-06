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
  const MOST_FAILED_COUNT = 40; // TOP global

  // ================= STATE =================
let state = { history: [], attempts: {}, starred: {}, demotedFailed: {}, failCounts: {}, autoStarNextAt: {}, resume: null };
  let menuReturn = { targetId: null, scrollY: 0 };

  function setMenuReturnByEl(el) {
    menuReturn.scrollY = window.scrollY || 0;
    menuReturn.targetId = (el && el.id) ? el.id : null;
  }

  function restoreMenuReturn() {
    const targetId = menuReturn.targetId;
    const y = menuReturn.scrollY || 0;

    // Wait until the menu has been rendered and laid out.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (targetId) {
          const el = document.getElementById(targetId);
          if (el) {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            return;
          }
        }
        window.scrollTo(0, y);
      });
    });
  }


  let currentBlock = [];
  let currentIndex = 0;
  let currentSessionTitle = "BLOQUE";
  const EXAM_QUESTION_COUNT = 40;
  let currentBlockStartIndex = null;
  let currentMode = "NORMAL";

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
      starred: safe.starred && typeof safe.starred === "object" ? safe.starred : {},
      demotedFailed: safe.demotedFailed && typeof safe.demotedFailed === "object" ? safe.demotedFailed : {},
      failCounts: safe.failCounts && typeof safe.failCounts === "object" ? safe.failCounts : {},
      autoStarNextAt: safe.autoStarNextAt && typeof safe.autoStarNextAt === "object" ? safe.autoStarNextAt : {},
      resume: safe.resume && typeof safe.resume === "object" ? safe.resume : null,
    };
  }

  function getFirstAttemptsMap() {
    const first = new Map();
    for (const h of state.history) {
      if (!first.has(h.questionId)) first.set(h.questionId, h);
    }
    return first;
  }

  function buildAttemptsById() {
    const byId = {};
    for (const h of state.history) {
      if (!h || !h.questionId) continue;
      (byId[h.questionId] ||= []).push(h);
    }
    return byId;
  }

  // Aprendida = existe una racha de 3 aciertos seguidos en su historial.
  function isLearned(qId, attemptsById) {
    const arr = attemptsById?.[qId];
    if (!arr || arr.length === 0) return false;
    let streak = 0;
    for (const a of arr) {
      if (a.selected === a.correct) {
        streak++;
        if (streak >= 3) return true;
      } else {
        streak = 0;
      }
    }
    return false;
  }

  function getBlockQuestions(startIndex) {
    return questions.slice(startIndex, startIndex + BLOCK_SIZE);
  }

  function getQuestionsForMode(startIndex, mode) {
    const blockQs = getBlockQuestions(startIndex);
    const first = getFirstAttemptsMap();
    const attemptsById = buildAttemptsById();

    if (mode === "NORMAL") return blockQs;

    // Falladas = primer intento mal O degradada desde FIRST_OK; y NO aprendida
    if (mode === "FAILED") {
      return blockQs.filter(q => {
        const a = first.get(q.id);
        const demoted = !!(state.demotedFailed && state.demotedFailed[q.id]);
        const firstWrong = !!(a && a.selected !== a.correct);
        return (firstWrong || demoted) && !isLearned(q.id, attemptsById);
      });
    }

    // Acertadas al primer intento = primer intento bien y NO degradada
    if (mode === "FIRST_OK") {
      return blockQs.filter(q => {
        const a = first.get(q.id);
        const demoted = !!(state.demotedFailed && state.demotedFailed[q.id]);
        return a && a.selected === a.correct && !demoted;
      });
    }

    // Aprendidas (solo lectura)
    if (mode === "LEARNED") {
      return blockQs.filter(q => isLearned(q.id, attemptsById));
    }

    return [];
  }

  function getLearnedQuestionsAll() {
    const attemptsById = buildAttemptsById();
    return questions.filter(q => isLearned(q.id, attemptsById));
  }

  function resetBlockData(startIndex) {
    const blockQuestions = getBlockQuestions(startIndex);
    const ids = new Set(blockQuestions.map(q => q.id));

    state.history = state.history.filter(h => !ids.has(h.questionId));
    for (const id of ids) delete state.attempts[id];
    for (const id of ids) delete state.starred[id];
    for (const id of ids) delete state.demotedFailed[id];
    for (const id of ids) delete state.failCounts[id];
    for (const id of ids) delete state.autoStarNextAt[id];
  }

  // ================= STATS =================
  function countStats() {
    const first = getFirstAttemptsMap();
    const attemptsById = buildAttemptsById();

    let responded = 0;
    let firstOk = 0; // a la primera (y no degradada)

    for (const [id, att] of first.entries()) {
      responded++;
      const demoted = !!(state.demotedFailed && state.demotedFailed[id]);
      if (att.selected === att.correct && !demoted) firstOk++;
    }

    // Aprendidas (3 seguidas)
    let learned = 0;
    for (const id in attemptsById) {
      if (isLearned(id, attemptsById)) learned++;
    }

    // Falladas actuales = primer intento mal O degradada; y NO aprendida
    let failedPending = 0;
    for (const [id, att] of first.entries()) {
      const demoted = !!(state.demotedFailed && state.demotedFailed[id]);
      const firstWrong = att.selected !== att.correct;
      if ((firstWrong || demoted) && !isLearned(id, attemptsById)) failedPending++;
    }
    // Nota: también puede haber degradadas sin "first" (raro). Las contamos igual:
    for (const idStr of Object.keys(state.demotedFailed || {})) {
      const id = isNaN(+idStr) ? idStr : +idStr;
      if (!first.has(id) && !isLearned(id, attemptsById)) failedPending++;
    }

    // Dominadas = racha de 2 aciertos seguidos en algún momento
    let dominadas = 0;
    for (const id in attemptsById) {
      const arr = attemptsById[id];
      let streak = 0;
      let ok = false;
      for (const a of arr) {
        if (a.selected === a.correct) {
          streak++;
          if (streak >= 2) { ok = true; break; }
        } else {
          streak = 0;
        }
      }
      if (ok) dominadas++;
    }

    const starredCount = state.starred ? Object.keys(state.starred).length : 0;
    return { responded, firstOk, learned, failed: failedPending, dominadas, starred: starredCount };
  }

  function createStatsPanel() {
    const stats = countStats();
    const panel = document.createElement("div");
    panel.className = "stats";

    const items = [
      { title: "Respondidas", value: stats.responded },
      { title: "A la primera", value: stats.firstOk },
      { title: "Aprendidas (3 seguidas)", value: stats.learned },
      { title: "Falladas", value: stats.failed },
      { title: "Dominadas", value: stats.dominadas },
      { title: "Marcadas", value: stats.starred },
    ];

    items.forEach(item => {
      const div = document.createElement("div");
      div.className = "stats-item";
      const val = document.createElement("span");
      val.className = "stats-value";
      val.textContent = item.value;
      const tit = document.createElement("span");
      tit.className = "stats-title";
      tit.textContent = item.title;
      div.appendChild(val);
      div.appendChild(tit);
      panel.appendChild(div);
    });

    return panel;
  }

  // ================= RESUME / SEARCH / ACTIONS =================
  function createResumeSection() {
    const container = document.createElement("div");
    container.className = "resume-container";
    const resumeInfo = state.resume;
    if (resumeInfo && typeof resumeInfo === "object") {
      const btn = document.createElement("button");
      let text = "Continuar";
      if (resumeInfo.sessionTitle) text += ` ${resumeInfo.sessionTitle}`;
      if (typeof resumeInfo.blockStartIndex === "number" && resumeInfo.blockStartIndex >= 0) {
        const blockNum = Math.floor(resumeInfo.blockStartIndex / BLOCK_SIZE) + 1;
        text += ` ${blockNum}`;
      }
      if (typeof resumeInfo.currentIndex === "number") text += ` (pregunta ${resumeInfo.currentIndex + 1})`;
      btn.textContent = text;
      btn.onclick = resume;
      container.appendChild(btn);
      container.style.display = "block";
    }
    return container;
  }

  function createSearchContainer() {
    const container = document.createElement("div");
    container.className = "search-container";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Buscar bloque, pregunta...";
    input.className = "search-input";
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") handleSearch(input.value);
    });
    container.appendChild(input);
    return container;
  }

  function createMenuActions() {
    const container = document.createElement("div");
    container.className = "menu-actions";

    const examBtn = document.createElement("button");
    examBtn.type = "button";
    examBtn.textContent = `Simulacro (${EXAM_QUESTION_COUNT})`;
    examBtn.id = "menu-action-exam";
    examBtn.onclick = () => { setMenuReturnByEl(examBtn); startExam(); };
    container.appendChild(examBtn);

    const starBtn = document.createElement("button");
    starBtn.type = "button";
    const starCount = state.starred ? Object.keys(state.starred).length : 0;
    starBtn.textContent = `Repasar marcadas (${starCount})`;
    starBtn.disabled = starCount === 0;
    starBtn.id = "menu-action-starred";
    starBtn.onclick = () => { setMenuReturnByEl(starBtn); startStarReview(); };
    container.appendChild(starBtn);

    const learnedAll = getLearnedQuestionsAll();
    const learnedBtn = document.createElement("button");
    learnedBtn.type = "button";
    learnedBtn.textContent = `Ver aprendidas (${learnedAll.length})`;
    learnedBtn.disabled = learnedAll.length === 0;
    learnedBtn.id = "menu-action-learned-all";
    learnedBtn.onclick = () => { setMenuReturnByEl(learnedBtn); startCustomQuestions(learnedAll, "APRENDIDAS", "LEARNED"); };
    container.appendChild(learnedBtn);

    return container;
  }


  // ================= FAIL COUNTS (for auto-star) =================
  function rebuildFailCountsFromHistory() {
    state.failCounts = {};
    for (const h of state.history || []) {
      if (!h || !h.questionId) continue;
      if (h.selected !== h.correct) {
        state.failCounts[h.questionId] = (state.failCounts[h.questionId] || 0) + 1;
      }
    }
  }

  function getFailCount(qId) {
    return Number((state.failCounts && state.failCounts[qId]) || 0);
  }

  function getNextAutoStarAt(qId) {
    const n = state.autoStarNextAt && state.autoStarNextAt[qId];
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 3;
  }
  // ================= STAR =================
  function toggleStar(qId) {
    state.starred ||= {};
    state.autoStarNextAt ||= {};

    const wasStarred = !!state.starred[qId];
    if (wasStarred) {
      // Manual unstar: don't auto-star again until the user accumulates 3 MORE fails.
      delete state.starred[qId];
      const failCount = getFailCount(qId);
      state.autoStarNextAt[qId] = failCount + 3;
    } else {
      // Manual star.
      state.starred[qId] = true;
    }

    updateStarButton(qId);
  }

  function updateStarButton(qId) {
    const btn = questionEl.querySelector(".star-btn");
    if (!btn) return;
    const starred = state.starred && state.starred[qId];
    btn.textContent = starred ? "★" : "☆";
    if (starred) btn.classList.add("starred");
    else btn.classList.remove("starred");
  }

  // ================= EXAM / STAR REVIEW =================
  function startExam() {
    const shuffled = questions.slice().sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, EXAM_QUESTION_COUNT);
    startCustomQuestions(selected, "EXAMEN", "CUSTOM");
  }

  function startStarReview() {
    const starredIds = state.starred ? Object.keys(state.starred) : [];
    if (starredIds.length === 0) {
      alert("No hay preguntas marcadas para repasar.");
      return;
    }

    const byId = new Map(questions.map(q => [q.id, q]));
    const qList = [];
    for (const id of starredIds) {
      const q = byId.get(Number(id)); // IDs guardadas como string
      if (q) qList.push(q);
    }

    if (qList.length === 0) {
      alert("Las preguntas marcadas ya no existen.");
      return;
    }

    startCustomQuestions(qList, "MARCADAS", "CUSTOM");
  }

  // ================= SEARCH =================
  function handleSearch(term) {
    const query = String(term || "").trim();
    if (!query) return;

    const num = parseInt(query, 10);
    if (!isNaN(num)) {
      const numBlocks = Math.ceil(questions.length / BLOCK_SIZE);
      if (num >= 1 && num <= numBlocks) {
        startBlock((num - 1) * BLOCK_SIZE, "NORMAL");
        return;
      }
      if (num >= 1 && num <= questions.length) {
        startCustomQuestions([questions[num - 1]], `Pregunta ${num}`, "CUSTOM");
        return;
      }
    }

    const termLower = query.toLowerCase();
    const results = questions.filter(q => {
      const inQuestion = (q.question || "").toLowerCase().includes(termLower);
      const inOptions = Object.values(q.options || {}).some(opt => String(opt || "").toLowerCase().includes(termLower));
      return inQuestion || inOptions;
    });

    if (results.length === 0) {
      alert("No se encontraron preguntas coincidentes.");
      return;
    }

    startCustomQuestions(results, `BUSCAR: ${query}`, "CUSTOM");
  }

  // ================= RESUME =================
  function resume() {
    const info = state.resume;
    if (!info || typeof info !== "object") return;

    if (typeof info.blockStartIndex === "number" && info.blockStartIndex >= 0) {
      startBlock(info.blockStartIndex, info.mode || "NORMAL");
    } else if (Array.isArray(info.customQuestions)) {
      startCustomQuestions(info.customQuestions, info.sessionTitle || "REPASO", info.mode || "CUSTOM");
    } else {
      return;
    }

    if (typeof info.currentIndex === "number" && info.currentIndex >= 0) {
      currentIndex = info.currentIndex;
      loadQuestion();
    }
  }

  // ================= MOST FAILED TOP =================
  function getMostFailedQuestionsTopN(n) {
    const failCount = new Map();
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
      // Rebuild derived counters (so auto-star works even for old saved states).
      rebuildFailCountsFromHistory();
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

  // ================= MENU RENDER =================
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

    const n = mostFailed.length;
    btn.textContent = n > 0
      ? `Repetir más falladas (${n} pregunta${n === 1 ? "" : "s"})`
      : `Repetir más falladas (${MOST_FAILED_COUNT})`;

    btn.disabled = n === 0;
    btn.onclick = () => {
      setMenuReturnByEl(btn);
      const qs = getMostFailedQuestionsTopN(MOST_FAILED_COUNT);
      if (qs.length === 0) {
        alert("Todavía no hay fallos registrados.");
        return;
      }
      startCustomQuestions(qs, "REPASO", "CUSTOM");
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

    const resumeSection = createResumeSection();
    if (resumeSection) menuEl.appendChild(resumeSection);

    menuEl.appendChild(createStatsPanel());
    menuEl.appendChild(createSearchContainer());
    menuEl.appendChild(createMenuActions());

    const numBlocks = Math.ceil(questions.length / BLOCK_SIZE);
    const first = getFirstAttemptsMap();
    const attemptsById = buildAttemptsById();

    for (let i = 0; i < numBlocks; i++) {
      const startIndex = i * BLOCK_SIZE;
      const start = startIndex + 1;
      const end = Math.min(startIndex + BLOCK_SIZE, questions.length);

      const blockQuestions = getBlockQuestions(startIndex);

      let firstOkCount = 0;          // a la primera (no degradada)
      let failedPendingCount = 0;    // falladas actuales (firstWrong o degradadas) y NO aprendidas
      let learnedCount = 0;          // aprendidas
      let recoveredCount = 0;        // para el %: falladas (o degradadas) que ya aprendiste
      let answeredCount = 0;

      for (const q of blockQuestions) {
        const a = first.get(q.id);
        const demoted = !!(state.demotedFailed && state.demotedFailed[q.id]);
        const learned = isLearned(q.id, attemptsById);

        if (learned) learnedCount++;

        const hasFirst = !!a;
        const consideredAnswered = hasFirst || demoted;
        if (!consideredAnswered) continue;

        answeredCount++;

        const firstWasCorrect = !!(a && a.selected === a.correct);
        const firstWasWrong = !!(a && a.selected !== a.correct);

        if (firstWasCorrect && !demoted) firstOkCount++;

        const isFailedNow = (firstWasWrong || demoted) && !learned;
        if (isFailedNow) failedPendingCount++;

        if ((firstWasWrong || demoted) && learned) recoveredCount++;
      }

      const correctNowCount = firstOkCount + recoveredCount;
      const percent = Math.round((correctNowCount / blockQuestions.length) * 100);

      const row = document.createElement("div");
      row.className = "block-row";

      const mainBtn = document.createElement("button");
      mainBtn.className = "block-main";
      mainBtn.textContent = `${start}-${end}`;
      mainBtn.id = `menu-${startIndex}-NORMAL`;
      mainBtn.onclick = () => { setMenuReturnByEl(mainBtn); startBlock(startIndex, "NORMAL"); };

      const percentEl = document.createElement("span");
      percentEl.className = "block-percent";
      percentEl.textContent = `${correctNowCount}/${blockQuestions.length} (${percent}%)`;

      if (answeredCount === 0) {
  percentEl.classList.add("pct-none");
} else if (correctNowCount === blockQuestions.length) {
  percentEl.classList.add("pct-good");
} else {
  percentEl.classList.add("pct-bad");
}

      const failedBtn = document.createElement("button");
      failedBtn.className = "block-mini";
      failedBtn.textContent = `Rehacer falladas (${failedPendingCount})`;
      failedBtn.disabled = failedPendingCount === 0;
      failedBtn.id = `menu-${startIndex}-FAILED`;
      failedBtn.onclick = () => { setMenuReturnByEl(failedBtn); startBlock(startIndex, "FAILED"); };

      const firstOkBtn = document.createElement("button");
      firstOkBtn.className = "block-mini";
      firstOkBtn.textContent = `Rehacer acertadas al primer intento (${firstOkCount})`;
      firstOkBtn.disabled = firstOkCount === 0;
      firstOkBtn.id = `menu-${startIndex}-FIRST_OK`;
      firstOkBtn.onclick = () => { setMenuReturnByEl(firstOkBtn); startBlock(startIndex, "FIRST_OK"); };

      const learnedBtn = document.createElement("button");
      learnedBtn.className = "block-mini";
      learnedBtn.textContent = `Ver aprendidas (${learnedCount})`;
      learnedBtn.disabled = learnedCount === 0;
      learnedBtn.id = `menu-${startIndex}-LEARNED`;
      learnedBtn.onclick = () => { setMenuReturnByEl(learnedBtn); startBlock(startIndex, "LEARNED"); };

      const resetBtn = document.createElement("button");
      resetBtn.className = "block-reset";
      resetBtn.textContent = "Reset";
      resetBtn.disabled = answeredCount === 0;
      resetBtn.id = `menu-${startIndex}-RESET`;
      resetBtn.onclick = async () => {
        setMenuReturnByEl(resetBtn);
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
      row.appendChild(learnedBtn);
      row.appendChild(resetBtn);

      menuEl.appendChild(row);
    }

    menuEl.appendChild(renderMenuFooter());
    restoreMenuReturn();
  }

  // ================= SESSION START =================
  function startBlock(startIndex, mode) {
    if (menuEl.style.display === "block" && !menuReturn.targetId) menuReturn.scrollY = window.scrollY || 0;
    if (mode === "FAILED") currentSessionTitle = "FALLADAS";
    else if (mode === "FIRST_OK") currentSessionTitle = "ACERTADAS (1er intento)";
    else if (mode === "LEARNED") currentSessionTitle = "APRENDIDAS";
    else currentSessionTitle = "BLOQUE";

    currentBlockStartIndex = startIndex;
    currentMode = mode;

    menuEl.style.display = "none";
    testEl.style.display = "block";
    blockMsgEl.style.display = "none";
    currentIndex = 0;

    currentBlock = getQuestionsForMode(startIndex, mode);

    if (currentBlock.length === 0) {
      alert("No hay preguntas para este bloque/modo.");
      showMenu();
      return;
    }

    state.resume = {
      blockStartIndex: currentBlockStartIndex,
      currentIndex: currentIndex,
      sessionTitle: currentSessionTitle,
      mode: currentMode,
    };

    loadQuestion();
  }

  function startCustomQuestions(qs, title, modeOverride) {
    if (menuEl.style.display === "block" && !menuReturn.targetId) menuReturn.scrollY = window.scrollY || 0;
    currentSessionTitle = title || "REPASO";
    currentBlockStartIndex = -1;
    currentMode = modeOverride || "CUSTOM";

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

    state.resume = {
      blockStartIndex: currentBlockStartIndex,
      currentIndex: currentIndex,
      sessionTitle: currentSessionTitle,
      mode: currentMode,
    };

    loadQuestion();
  }

  // ================= QUESTION RENDER =================
  function loadQuestion() {
    const q = currentBlock[currentIndex];

    questionEl.innerHTML = "";
    const headerDiv = document.createElement("div");
    headerDiv.className = "question-header";

    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "star-btn";
    const isStarred = state.starred && state.starred[q.id];
    starBtn.textContent = isStarred ? "★" : "☆";
    if (isStarred) starBtn.classList.add("starred");
    starBtn.onclick = () => toggleStar(q.id);
    headerDiv.appendChild(starBtn);

    const textSpan = document.createElement("span");
    textSpan.textContent = q.question;
    headerDiv.appendChild(textSpan);

    questionEl.appendChild(headerDiv);

    optionsEl.innerHTML = "";

    if (currentMode === "LEARNED") {
      const correctLetter = q.correct;
      const correctText = (q.options && q.options[correctLetter]) ? q.options[correctLetter] : "";
      const box = document.createElement("div");
      box.className = "learned-answer";
      box.textContent = `Respuesta correcta: ${correctLetter}) ${correctText}`;
      optionsEl.appendChild(box);
      nextBtn.disabled = false;
      return;
    }

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

    // Si estás en "Rehacer acertadas al primer intento" y la fallas => pasa a falladas (degradada)
    if (currentMode === "FIRST_OK" && selected !== correct) {
      state.demotedFailed ||= {};
      state.demotedFailed[qId] = true;
    }

    // ===== Auto-star when a question is failed 3 times (not necessarily consecutive).
    // If the user manually unstars it, we won't auto-star again until 3 MORE fails happen.
    state.failCounts ||= {};
    state.autoStarNextAt ||= {};
    if (selected !== correct) {
      state.failCounts[qId] = (state.failCounts[qId] || 0) + 1;
      const failCount = state.failCounts[qId];
      const nextAt = getNextAutoStarAt(qId);
      if (failCount >= nextAt && !(state.starred && state.starred[qId])) {
        state.starred ||= {};
        state.starred[qId] = true;
        updateStarButton(qId);
      }
    }

    state.attempts[qId] = (state.attempts[qId] || 0) + 1;
    nextBtn.disabled = false;

    state.resume = {
      blockStartIndex: currentBlockStartIndex,
      currentIndex: currentIndex,
      sessionTitle: currentSessionTitle,
      mode: currentMode,
    };
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

    if (currentIndex < currentBlock.length) {
      state.resume = {
        blockStartIndex: currentBlockStartIndex,
        currentIndex: currentIndex,
        sessionTitle: currentSessionTitle,
        mode: currentMode,
      };
    }

    if (currentIndex >= currentBlock.length) {
      state.resume = null;
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
  };


  // ================= SHORTCUTS (keyboard + touch) =================
  function isTypingInInput(target) {
    const el = target;
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable;
  }

  // Keyboard: Enter = next (if enabled)
  // A/B/C/D = pick option (if not answered yet)
  document.addEventListener("keydown", (ev) => {
    if (isTypingInInput(ev.target)) return;
    if (testEl.style.display !== "block") return;

    const key = String(ev.key || "").toLowerCase();

    // Enter -> next
    if (key === "enter") {
      if (!nextBtn.disabled) {
        ev.preventDefault();
        nextBtn.click();
      }
      return;
    }

    // A/B/C/D -> select option (only if still answering)
    if (key === "a" || key === "b" || key === "c" || key === "d") {
      if (currentMode === "LEARNED") return;
      if (!nextBtn.disabled) return; // already answered
      const btn = optionsEl.querySelector(`button[data-letter="${key.toUpperCase()}"]`);
      if (btn && !btn.disabled) {
        ev.preventDefault();
        btn.click();
      }
    }
  });

  // Touch swipe on test screen:
  // - Swipe RIGHT -> LEFT  => Next (if enabled)
  // - Swipe LEFT  -> RIGHT => Back to menu
  (function initSwipeShortcuts() {
    let startX = 0;
    let startY = 0;
    let startT = 0;

    const SWIPE_MIN_X = 55;  // px
    const SWIPE_MAX_Y = 45;  // px
    const SWIPE_MAX_TIME = 900; // ms

    testEl.addEventListener("touchstart", (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
    }, { passive: true });

    testEl.addEventListener("touchend", (e) => {
      if (testEl.style.display !== "block") return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startT;

      if (dt > SWIPE_MAX_TIME) return;
      if (Math.abs(dx) < SWIPE_MIN_X) return;
      if (Math.abs(dy) > SWIPE_MAX_Y) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) return; // mostly horizontal

      // RIGHT -> LEFT (dx negative) => Next
      if (dx < 0) {
        if (!nextBtn.disabled) nextBtn.click();
        return;
      }

      // LEFT -> RIGHT => Menu
      if (dx > 0) {
        if (backToMenuBtn) backToMenuBtn.click();
      }
    }, { passive: true });
  })();
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

});
