const express = require('express');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('express').urlencoded({ extended: true });

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');

async function initDb() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      author_name TEXT NOT NULL,
      title TEXT DEFAULT 'TuMeConnaisVraiment',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS choices (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      responder_name TEXT,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      answers TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );
  `);
  return db;
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

let dbPromise = initDb();

app.get('/', async (req, res) => {
  res.render('index', { maxQuestions: 10, minQuestions: 5 });
});

app.post('/create', bodyParser, async (req, res) => {
  try {
    const db = await dbPromise;
    const author_name = (req.body.author_name || 'Anonyme').trim().slice(0, 120);
    const title = (req.body.title || 'TuMeConnaisVraiment').trim().slice(0, 200);
    // questions[] will be an array of objects in form data: question_0, choice_0_0 etc.
    // We expect form fields: q_TEXT_<i> and c_TEXT_<i>_<j> and c_CORR_<i> = index of correct choice
    const quizId = uuidv4();
    await db.run('INSERT INTO quizzes (id, author_name, title, created_at) VALUES (?,?,?,?)',
      quizId, author_name, title, Date.now());

    // parse posted questions
    const questions = [];
    for (let i = 0; i < 50; i++) {
      const qKey = `q_TEXT_${i}`;
      if (!(qKey in req.body)) break;
      const qText = (req.body[qKey] || '').trim();
      if (!qText) continue;
      const qId = uuidv4();
      const position = questions.length;
      await db.run('INSERT INTO questions (id, quiz_id, text, position) VALUES (?,?,?,?)',
        qId, quizId, qText, position);

      // collect choices for this question
      const choices = [];
      for (let j = 0; j < 10; j++) {
        const cKey = `c_TEXT_${i}_${j}`;
        if (!(cKey in req.body)) break;
        const cText = (req.body[cKey] || '').trim();
        if (!cText) continue;
        choices.push({ text: cText, position: choices.length });
      }

      // require at least 2 choices
      if (choices.length < 2) {
        // cleanup and error
        await db.run('DELETE FROM quizzes WHERE id = ?', quizId);
        return res.status(400).send('Chaque question doit avoir au moins 2 choix.');
      }

      const correctIndex = parseInt(req.body[`c_CORR_${i}`] || '0', 10);
      for (let k = 0; k < choices.length; k++) {
        const choiceId = uuidv4();
        const is_correct = (k === correctIndex) ? 1 : 0;
        await db.run('INSERT INTO choices (id, question_id, text, is_correct, position) VALUES (?,?,?,?,?)',
          choiceId, qId, choices[k].text, is_correct, k);
      }

      questions.push({ qId, qText });
    }

    if (questions.length < 5 || questions.length > 10) {
      await db.run('DELETE FROM quizzes WHERE id = ?', quizId);
      return res.status(400).send('Le quiz doit contenir entre 5 et 10 questions.');
    }

    // success - give shareable link
    const host = req.get('host');
    const protocol = req.protocol;
    const shareUrl = `${protocol}://${host}/quiz/${quizId}`;
    res.render('created', { shareUrl, quizId, title, author_name });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur lors de la création du quiz.');
  }
});

app.get('/quiz/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const quizId = req.params.id;
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', quizId);
    if (!quiz) return res.status(404).send('Quiz introuvable.');

    const questions = await db.all('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position', quizId);
    for (const q of questions) {
      q.choices = await db.all('SELECT id, text FROM choices WHERE question_id = ? ORDER BY position', q.id);
    }
    res.render('quiz', { quiz, questions });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur.');
  }
});

app.post('/quiz/:id/submit', bodyParser, async (req, res) => {
  try {
    const db = await dbPromise;
    const quizId = req.params.id;
    const responder_name = (req.body.responder_name || 'Invité').trim().slice(0, 120);
    const answers = req.body; // format: answer_<questionId>=<choiceId>
    const questionRows = await db.all('SELECT id FROM questions WHERE quiz_id = ?', quizId);

    let score = 0;
    let total = questionRows.length;
    const recordedAnswers = [];

    for (const q of questionRows) {
      const ansKey = `answer_${q.id}`;
      const givenChoiceId = req.body[ansKey] || null;
      if (!givenChoiceId) {
        recordedAnswers.push({ questionId: q.id, choiceId: null, correct: false });
        continue;
      }
      const choice = await db.get('SELECT is_correct FROM choices WHERE id = ? AND question_id = ?', givenChoiceId, q.id);
      const correct = choice && choice.is_correct === 1;
      if (correct) score++;
      recordedAnswers.push({ questionId: q.id, choiceId: givenChoiceId, correct: !!correct });
    }

    const submissionId = uuidv4();
    await db.run('INSERT INTO submissions (id, quiz_id, responder_name, score, total, answers, created_at) VALUES (?,?,?,?,?,?,?)',
      submissionId, quizId, responder_name, score, total, JSON.stringify(recordedAnswers), Date.now());

    res.render('result', { quizId, responder_name, score, total, submissionId });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de l\'enregistrement des réponses.');
  }
});

app.get('/quiz/:id/leaderboard', async (req, res) => {
  try {
    const db = await dbPromise;
    const quizId = req.params.id;
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', quizId);
    if (!quiz) return res.status(404).send('Quiz introuvable.');

    const subs = await db.all('SELECT responder_name, score, total, created_at FROM submissions WHERE quiz_id = ? ORDER BY score DESC, created_at ASC LIMIT 100', quizId);
    res.render('leaderboard', { quiz, subs });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur.');
  }
});

// Small health route
app.get('/healthz', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TuMeConnaisVraiment — server listening on port ${PORT}`);
});const express = require('express');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('express').urlencoded({ extended: true });

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');

async function initDb() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      author_name TEXT NOT NULL,
      title TEXT DEFAULT 'TuMeConnaisVraiment',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS choices (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      responder_name TEXT,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      answers TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );
  `);
  return db;
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

let dbPromise = initDb();

app.get('/', async (req, res) => {
  res.render('index', { maxQuestions: 10, minQuestions: 5 });
});

app.post('/create', bodyParser, async (req, res) => {
  try {
    const db = await dbPromise;
    const author_name = (req.body.author_name || 'Anonyme').trim().slice(0, 120);
    const title = (req.body.title || 'TuMeConnaisVraiment').trim().slice(0, 200);
    // questions[] will be an array of objects in form data: question_0, choice_0_0 etc.
    // We expect form fields: q_TEXT_<i> and c_TEXT_<i>_<j> and c_CORR_<i> = index of correct choice
    const quizId = uuidv4();
    await db.run('INSERT INTO quizzes (id, author_name, title, created_at) VALUES (?,?,?,?)',
      quizId, author_name, title, Date.now());

    // parse posted questions
    const questions = [];
    for (let i = 0; i < 50; i++) {
      const qKey = `q_TEXT_${i}`;
      if (!(qKey in req.body)) break;
      const qText = (req.body[qKey] || '').trim();
      if (!qText) continue;
      const qId = uuidv4();
      const position = questions.length;
      await db.run('INSERT INTO questions (id, quiz_id, text, position) VALUES (?,?,?,?)',
        qId, quizId, qText, position);

      // collect choices for this question
      const choices = [];
      for (let j = 0; j < 10; j++) {
        const cKey = `c_TEXT_${i}_${j}`;
        if (!(cKey in req.body)) break;
        const cText = (req.body[cKey] || '').trim();
        if (!cText) continue;
        choices.push({ text: cText, position: choices.length });
      }

      // require at least 2 choices
      if (choices.length < 2) {
        // cleanup and error
        await db.run('DELETE FROM quizzes WHERE id = ?', quizId);
        return res.status(400).send('Chaque question doit avoir au moins 2 choix.');
      }

      const correctIndex = parseInt(req.body[`c_CORR_${i}`] || '0', 10);
      for (let k = 0; k < choices.length; k++) {
        const choiceId = uuidv4();
        const is_correct = (k === correctIndex) ? 1 : 0;
        await db.run('INSERT INTO choices (id, question_id, text, is_correct, position) VALUES (?,?,?,?,?)',
          choiceId, qId, choices[k].text, is_correct, k);
      }

      questions.push({ qId, qText });
    }

    if (questions.length < 5 || questions.length > 10) {
      await db.run('DELETE FROM quizzes WHERE id = ?', quizId);
      return res.status(400).send('Le quiz doit contenir entre 5 et 10 questions.');
    }

    // success - give shareable link
    const host = req.get('host');
    const protocol = req.protocol;
    const shareUrl = `${protocol}://${host}/quiz/${quizId}`;
    res.render('created', { shareUrl, quizId, title, author_name });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur lors de la création du quiz.');
  }
});

app.get('/quiz/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const quizId = req.params.id;
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', quizId);
    if (!quiz) return res.status(404).send('Quiz introuvable.');

    const questions = await db.all('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position', quizId);
    for (const q of questions) {
      q.choices = await db.all('SELECT id, text FROM choices WHERE question_id = ? ORDER BY position', q.id);
    }
    res.render('quiz', { quiz, questions });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur.');
  }
});

app.post('/quiz/:id/submit', bodyParser, async (req, res) => {
  try {
    const db = await dbPromise;
    const quizId = req.params.id;
    const responder_name = (req.body.responder_name || 'Invité').trim().slice(0, 120);
    const answers = req.body; // format: answer_<questionId>=<choiceId>
    const questionRows = await db.all('SELECT id FROM questions WHERE quiz_id = ?', quizId);

    let score = 0;
    let total = questionRows.length;
    const recordedAnswers = [];

    for (const q of questionRows) {
      const ansKey = `answer_${q.id}`;
      const givenChoiceId = req.body[ansKey] || null;
      if (!givenChoiceId) {
        recordedAnswers.push({ questionId: q.id, choiceId: null, correct: false });
        continue;
      }
      const choice = await db.get('SELECT is_correct FROM choices WHERE id = ? AND question_id = ?', givenChoiceId, q.id);
      const correct = choice && choice.is_correct === 1;
      if (correct) score++;
      recordedAnswers.push({ questionId: q.id, choiceId: givenChoiceId, correct: !!correct });
    }

    const submissionId = uuidv4();
    await db.run('INSERT INTO submissions (id, quiz_id, responder_name, score, total, answers, created_at) VALUES (?,?,?,?,?,?,?)',
      submissionId, quizId, responder_name, score, total, JSON.stringify(recordedAnswers), Date.now());

    res.render('result', { quizId, responder_name, score, total, submissionId });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de l\'enregistrement des réponses.');
  }
});

app.get('/quiz/:id/leaderboard', async (req, res) => {
  try {
    const db = await dbPromise;
    const quizId = req.params.id;
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', quizId);
    if (!quiz) return res.status(404).send('Quiz introuvable.');

    const subs = await db.all('SELECT responder_name, score, total, created_at FROM submissions WHERE quiz_id = ? ORDER BY score DESC, created_at ASC LIMIT 100', quizId);
    res.render('leaderboard', { quiz, subs });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur.');
  }
});

// Small health route
app.get('/healthz', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TuMeConnaisVraiment — server listening on port ${PORT}`);
});
