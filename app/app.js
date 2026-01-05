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
  // The app keeps track of answered questions (history), number of
  // attempts per question, starred questions and the last point the
  // user reached (resume).  The starred and resume properties may
  // not exist in older saved data, so we normalise them later.
  let state = { history: [], attempts: {}, starred: {}, resume: null };
  let currentBlock = [];
  let currentIndex = 0;
  let currentSessionTitle = "BLOQUE";
  // Additional runtime variables used to build the resume state.  When
  // starting a block or custom question set we record the start index
  // and mode so we know how to restore it later.
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

    const history = Array.isArray(safe.history) ? safe.history : [];
    const attempts = safe.attempts && typeof safe.attempts === "object" ? safe.attempts : {};
    const starred = safe.starred && typeof safe.starred === "object" ? safe.starred : {};
    const demotedFailed = safe.demotedFailed && typeof safe.demotedFailed === "object" ? safe.demotedFailed : {};

    // Fail counts (for auto-star after 3 fails). If not present, rebuild from history.
    let failCounts = safe.failCounts && typeof safe.failCounts === "object" ? safe.failCounts : null;
    if (!failCounts) {
      failCounts = {};
      for (const h of history) {
        if (!h || !h.questionId) continue;
        if (h.selected !== h.correct) {
          failCounts[h.questionId] = (failCounts[h.questionId] || 0) + 1;
        }
      }
    }

    // Remembers which questions already triggered an auto-star once (so user can unstar manually and it won't auto-star again).
    const autoStarApplied = safe.autoStarApplied && typeof safe.autoStarApplied === "object" ? safe.autoStarApplied : {};

    const resume = safe.resume && typeof safe.resume === "object" ? safe.resume : null;

    return { history, attempts, starred, demotedFailed, failCounts, autoStarApplied, resume };
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
    const demoted = state.demotedFailed || {};

    if (mode === "NORMAL") return blockQs;

    // Falladas:
    // - primer intento incorrecto
    // - o degradadas (falladas mientras repasabas las acertadas al primer intento)
    if (mode === "FAILED") {
      return blockQs.filter(q => {
        const a = first.get(q.id);
        return (a && a.selected !== a.correct) || !!demoted[q.id];
      });
    }

    // Acertadas al primer intento (excluyendo las degradadas)
    if (mode === "FIRST_OK") {
      return blockQs.filter(q => {
        const a = first.get(q.id);
        return a && a.selected === a.correct && !demoted[q.id];
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

  // ================= EXTENDED STATS AND ACTIONS =================
  /**
   * Count overall statistics based off the stored history.  A
   * question is considered "dominada" if it was answered correctly
   * at least twice in a row at any point in its history.  This
   * function groups attempts per question to determine that streak.
   *
   * Returns an object with properties: responded (number of unique
   * questions answered at least once), correct (number of unique
   * questions answered correctly on the first attempt), failed
   * (number of unique questions answered incorrectly on the first
   * attempt), dominadas (number of questions with two consecutive
   * correct answers), starred (current count of starred questions).
   */
  function countStats() {
    const first = getFirstAttemptsMap();
    let responded = 0;
    let correct = 0;
    let failed = 0;

    // Count unique answered, correct on first attempt and wrong on first attempt
    for (const [id, att] of first.entries()) {
      responded++;
      if (att.selected === att.correct) correct++;
      else failed++;
    }

    // Group all attempts by questionId
    const byId = {};
    for (const h of state.history) {
      if (!h || !h.questionId) continue;
      if (!byId[h.questionId]) byId[h.questionId] = [];
      byId[h.questionId].push(h);
    }
    let dominadas = 0;
    for (const id in byId) {
      const arr = byId[id];
      let streak = 0;
      let dominated = false;
      for (const a of arr) {
        if (a.selected === a.correct) {
          streak++;
          if (streak >= 2) {
            dominated = true;
            break;
          }
        } else {
          streak = 0;
        }
      }
      if (dominated) dominadas++;
    }
    const starredCount = state.starred ? Object.keys(state.starred).length : 0;
    return { responded, correct, failed, dominadas, starred: starredCount };
  }

  /**
   * Build and return a statistics panel element based on current data.
   */
  function createStatsPanel() {
    const stats = countStats();
    const panel = document.createElement("div");
    panel.className = "stats";
    const items = [
      { title: "Respondidas", value: stats.responded },
      { title: "Acertadas", value: stats.correct },
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

  /**
   * Build and return a resume section.  If state.resume exists and
   * contains valid data, the section will show a button allowing the
   * user to continue where they left off.
   */
  function createResumeSection() {
    const container = document.createElement("div");
    container.className = "resume-container";
    const resumeInfo = state.resume;
    if (resumeInfo && typeof resumeInfo === "object") {
      const btn = document.createElement("button");
      // Determine display text for the resume button
      let text = "Continuar";
      if (resumeInfo.sessionTitle) {
        text += ` ${resumeInfo.sessionTitle}`;
      }
      if (typeof resumeInfo.blockStartIndex === "number" && resumeInfo.blockStartIndex >= 0) {
        const blockNum = Math.floor(resumeInfo.blockStartIndex / BLOCK_SIZE) + 1;
        text += ` ${blockNum}`;
      }
      if (typeof resumeInfo.currentIndex === "number") {
        const qNum = resumeInfo.currentIndex + 1;
        text += ` (pregunta ${qNum})`;
      }
      btn.textContent = text;
      btn.onclick = resume;
      container.appendChild(btn);
      container.style.display = "block";
    }
    return container;
  }

  /**
   * Build and return a search container with an input for searching
   * blocks or questions.  The input triggers a search when the user
   * presses Enter.
   */
  function createSearchContainer() {
    const container = document.createElement("div");
    container.className = "search-container";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Buscar bloque, pregunta...";
    input.className = "search-input";
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        handleSearch(input.value);
      }
    });
    container.appendChild(input);
    return container;
  }

  /**
   * Build and return a container with action buttons for exam and
   * reviewing starred questions.
   */
  function createMenuActions() {
    const container = document.createElement("div");
    container.className = "menu-actions";
    // Exam button
    const examBtn = document.createElement("button");
    examBtn.type = "button";
    examBtn.textContent = `Simulacro (${EXAM_QUESTION_COUNT})`;
    examBtn.onclick = startExam;
    container.appendChild(examBtn);
    // Star review button
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    const starCount = state.starred ? Object.keys(state.starred).length : 0;
    starBtn.textContent = `Repasar marcadas (${starCount})`;
    starBtn.disabled = starCount === 0;
    starBtn.onclick = startStarReview;
    container.appendChild(starBtn);
    return container;
  }

  /**
   * Toggle the starred state of a question by id.  Updates the
   * internal state and the star button UI.
   */
  function toggleStar(qId) {
    if (!state.starred) state.starred = {};
    if (state.starred[qId]) {
      delete state.starred[qId];
    } else {
      state.starred[qId] = true;
    }
    updateStarButton(qId);
  }

  /**
   * Update the appearance of the star button in the current question
   * header based on whether the question is starred.  Also update
   * aria-labels for accessibility.
   */
  function updateStarButton(qId) {
    const btn = questionEl.querySelector(".star-btn");
    if (!btn) return;
    const starred = state.starred && state.starred[qId];
    btn.textContent = starred ? "★" : "☆";
    if (starred) btn.classList.add("starred");
    else btn.classList.remove("starred");
  }

  /**
   * Start an exam with a fixed number of random questions.  The
   * questions are selected at random from the full question set.  If
   * there are fewer than EXAM_QUESTION_COUNT questions, all are used.
   */
  function startExam() {
    // Create a shuffled copy of the questions array
    const shuffled = questions.slice().sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, EXAM_QUESTION_COUNT);
    startCustomQuestions(selected, "EXAMEN");
  }

  /**
   * Start a session with only the starred questions.  If there are no
   * starred questions the user is informed.
   */
  
function startStarReview() {
  const starredIds = state.starred ? Object.keys(state.starred) : [];
  if (starredIds.length === 0) {
    alert("No hay preguntas marcadas para repasar.");
    return;
  }

  // 👇 Map con IDs numéricos
  const byId = new Map(questions.map(q => [q.id, q]));
  const qList = [];

  for (const id of starredIds) {
    const q = byId.get(Number(id)); // ✅ FIX CLAVE
    if (q) qList.push(q);
  }

  if (qList.length === 0) {
    alert("Las preguntas marcadas ya no existen.");
    return;
  }

  startCustomQuestions(qList, "MARCADAS");
}
  /**
   * Search for blocks or questions based on the user's input.  A
   * numeric value is interpreted as a block number (1-based) or
   * question index.  Otherwise a free-text search is performed on
   * question text and option contents.
   */
  function handleSearch(term) {
    if (!term) return;
    const query = String(term).trim();
    if (!query) return;
    const num = parseInt(query, 10);
    if (!isNaN(num)) {
      // Determine whether it's a block number or question index
      const numBlocks = Math.ceil(questions.length / BLOCK_SIZE);
      if (num >= 1 && num <= numBlocks) {
        const startIdx = (num - 1) * BLOCK_SIZE;
        startBlock(startIdx, "NORMAL");
        return;
      }
      if (num >= 1 && num <= questions.length) {
        const q = questions[num - 1];
        startCustomQuestions([q], `Pregunta ${num}`);
        return;
      }
    }
    // Free-text search
    const termLower = query.toLowerCase();
    const results = questions.filter(q => {
      const inQuestion = q.question && q.question.toLowerCase().includes(termLower);
      const inOptions = Object.values(q.options || {}).some(opt => (opt || "").toLowerCase().includes(termLower));
      return inQuestion || inOptions;
    });
    if (results.length === 0) {
      alert("No se encontraron preguntas coincidentes.");
      return;
    }
    startCustomQuestions(results, `BUSCAR: ${query}`);
  }

  /**
   * Continue from the saved resume position.  Restores the last block
   * and question index.  If there is no valid resume information
   * nothing happens.
   */
  function resume() {
    const info = state.resume;
    if (!info || typeof info !== "object") return;
    // Determine the set of questions to load based on saved mode
    if (typeof info.blockStartIndex === "number" && info.blockStartIndex >= 0) {
      // Normal block session
      currentBlockStartIndex = info.blockStartIndex;
      currentMode = info.mode || "NORMAL";
      startBlock(info.blockStartIndex, currentMode);
    } else if (Array.isArray(info.customQuestions)) {
      // Custom session saved - not used in this version but kept for
      // completeness
      startCustomQuestions(info.customQuestions, info.sessionTitle || "REPASO");
    } else {
      return;
    }
    // After starting block, override currentIndex and sessionTitle
    if (typeof info.currentIndex === "number" && info.currentIndex >= 0) {
      currentIndex = info.currentIndex;
      // reload the saved question instead of the first one
      loadQuestion();
    }
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
    // Top bar (title and logout)
    menuEl.appendChild(renderMenuTopbar());
    // Optional resume button
    const resumeSection = createResumeSection();
    if (resumeSection) menuEl.appendChild(resumeSection);
    // Global statistics panel
    menuEl.appendChild(createStatsPanel());
    // Search bar
    menuEl.appendChild(createSearchContainer());
    // Additional actions (exam and review starred)
    menuEl.appendChild(createMenuActions());

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

        // Si está degradada, cuenta como fallada (aunque el primer intento fuera correcto)
        if (state.demotedFailed && state.demotedFailed[q.id]) {
          failedCount++;
        } else if (a.selected === a.correct) {
          correctCount++;
        } else {
          failedCount++;
        }
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
      else if (correctCount === blockQuestions.length) percentEl.classList.add("pct-good");
      else percentEl.classList.add("pct-bad");

      const failedBtn = document.createElement("button");
      failedBtn.className = "block-mini";
      failedBtn.textContent = `Rehacer falladas (${failedCount})`;
      failedBtn.disabled = failedCount === 0;
      failedBtn.onclick = () => startBlock(startIndex, "FAILED");

      const firstOkBtn = document.createElement("button");
      firstOkBtn.className = "block-mini";
      firstOkBtn.textContent = `Rehacer acertadas al primer intento (${correctCount})`;
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
  }

  // ================= SESIONES DE PREGUNTAS =================
  function startBlock(startIndex, mode) {
    currentSessionTitle = "BLOQUE";
    currentBlockStartIndex = startIndex;
    currentMode = mode;
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
    currentBlockStartIndex = -1;
    currentMode = "CUSTOM";
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
    // Render question header with star icon
    questionEl.innerHTML = "";
    const headerDiv = document.createElement("div");
    headerDiv.className = "question-header";
    // Star button
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "star-btn";
    const isStarred = state.starred && state.starred[q.id];
    starBtn.textContent = isStarred ? "★" : "☆";
    if (isStarred) starBtn.classList.add("starred");
    starBtn.onclick = () => toggleStar(q.id);
    headerDiv.appendChild(starBtn);
    // Question text
    const textSpan = document.createElement("span");
    textSpan.textContent = q.question;
    headerDiv.appendChild(textSpan);
    questionEl.appendChild(headerDiv);

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

    const isCorrect = selected === correct;
    if (isCorrect) event.target.classList.add("correct");
    else event.target.classList.add("incorrect");

    state.history.push({
      questionId: qId,
      selected,
      correct,
      date: new Date().toISOString()
    });

    state.attempts[qId] = (state.attempts[qId] || 0) + 1;

    // Si estás repasando "acertadas al primer intento" y fallas, la degradamos para que pase a "falladas"
    if (!isCorrect && currentMode === "FIRST_OK") {
      if (!state.demotedFailed) state.demotedFailed = {};
      state.demotedFailed[qId] = true;
    }

    // Auto-marcado: si la fallas 3 veces en cualquier momento, se marca con estrella (una sola vez)
    if (!isCorrect) {
      if (!state.failCounts) state.failCounts = {};
      state.failCounts[qId] = (state.failCounts[qId] || 0) + 1;

      if (!state.autoStarApplied) state.autoStarApplied = {};
      const alreadyApplied = !!state.autoStarApplied[qId];

      if (state.failCounts[qId] >= 3 && !alreadyApplied) {
        if (!state.starred) state.starred = {};
        state.starred[qId] = true;           // marca
        state.autoStarApplied[qId] = true;   // recuerda que ya aplicó (para que puedas desmarcar manualmente)
        updateStarButton(qId);               // refresca icono si estás en esa pregunta
      }
    }

    nextBtn.disabled = false;

    // Update resume information so the user can continue at this point
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

  
  // ================= GESTOS TÁCTILES (MÓVIL) =================
  // Swipe derecha: siguiente (si ya has respondido)
  // Swipe izquierda: volver al menú
  (function setupSwipeGestures() {
    if (!testEl) return;

    let startX = 0;
    let startY = 0;

    testEl.addEventListener("touchstart", (e) => {
      if (testEl.style.display !== "block") return;
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
    }, { passive: true });

    testEl.addEventListener("touchend", (e) => {
      if (testEl.style.display !== "block") return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      const THRESHOLD = 60;       // px
      const V_TOLERANCE = 40;     // px

      // Evitar disparos cuando es scroll vertical
      if (Math.abs(dy) > V_TOLERANCE && Math.abs(dy) > Math.abs(dx)) return;

      if (dx > THRESHOLD) {
        // swipe derecha -> siguiente (solo si está habilitado)
        if (!nextBtn.disabled) nextBtn.click();
      } else if (dx < -THRESHOLD) {
        // swipe izquierda -> volver
        if (backToMenuBtn) backToMenuBtn.click();
      }
    }, { passive: true });
  })();

nextBtn.onclick = async () => {
    currentIndex++;
    // If we've moved to the next question, update resume to reflect the new index
    if (currentIndex < currentBlock.length) {
      state.resume = {
        blockStartIndex: currentBlockStartIndex,
        currentIndex: currentIndex,
        sessionTitle: currentSessionTitle,
        mode: currentMode,
      };
    }

    if (currentIndex >= currentBlock.length) {
      // End of session: clear resume so it does not offer to continue
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
  // Provide keyboard shortcuts for quicker navigation.  The shortcuts
  // only trigger when the focus is not inside an input field.  Keys:
  //  Enter – siguiente (si ya has respondido)
  //  A/B/C/D – responder opciones
  //  n – siguiente (si ya has respondido)
  //  ESC – volver al menú (mientras estás en un test)
  //  r/R – repeat most failed questions
  //  c/C – continue from resume
  document.addEventListener("keydown", (ev) => {
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const key = ev.key;

    // ENTER = siguiente (si ya has respondido)
    if (key === "Enter") {
      if (testEl.style.display === "block" && !nextBtn.disabled) {
        ev.preventDefault();
        nextBtn.click();
      }
      return;
    }

    // A/B/C/D = responder (si estás en una pregunta y aún no has respondido)
    const lower = (key || "").toLowerCase();
    if (["a", "b", "c", "d"].includes(lower)) {
      if (testEl.style.display === "block" && nextBtn.disabled) {
        const letter = lower.toUpperCase();
        const btn = optionsEl.querySelector(`button[data-letter="${letter}"]`);
        if (btn && !btn.disabled) {
          ev.preventDefault();
          btn.click();
        }
      }
      return;
    }

    // ESC = volver al menú
    if (key === "Escape") {
      if (testEl.style.display === "block") {
        ev.preventDefault();
        backToMenuBtn && backToMenuBtn.click();
      }
      return;
    }

    // Atajos extra existentes
    const k = lower;
    if (k === "n") {
      if (testEl.style.display === "block" && !nextBtn.disabled) {
        nextBtn.click();
      }
    } else if (k === "r") {
      const repeatBtn = document.getElementById("repeatMostFailedBtn");
      if (repeatBtn && !repeatBtn.disabled) repeatBtn.click();
    } else if (k === "c") {
      const resumeBtn = document.querySelector(".resume-container button");
      if (resumeBtn && resumeBtn.offsetParent !== null) {
        resumeBtn.click();
      }
    }
  });


});
