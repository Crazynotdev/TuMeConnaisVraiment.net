// Client helper for create page and small UX improvements
(function(){
  // Create page: dynamic questions management
  function initCreate() {
    const questionsRoot = document.getElementById('questions');
    if (!questionsRoot) return;

    const minQ = window.WMC && window.WMC.minQuestions || 5;
    const maxQ = window.WMC && window.WMC.maxQuestions || 10;
    let count = 0;

    function createQuestionBlock(index) {
      const wrapper = document.createElement('div');
      wrapper.className = 'question-block';
      wrapper.dataset.index = index;
      wrapper.innerHTML = `
        <fieldset class="question">
          <legend>Question ${index+1} 📝</legend>
          <label>Intitulé
            <input required type="text" name="q_TEXT_${index}" placeholder="Ex : Quel est son plat préféré ?" />
          </label>
          <div class="choices" data-qindex="${index}">
            <label>Choix 1
              <input required type="text" name="c_TEXT_${index}_0" placeholder="Ex : Pizza" />
            </label>
            <label>Choix 2
              <input required type="text" name="c_TEXT_${index}_1" placeholder="Ex : Sushi" />
            </label>
            <input type="hidden" name="c_CORR_${index}" value="0" />
            <div class="choice-controls">
              <button type="button" class="btn small add-choice">Ajouter un choix</button>
              <label class="muted">Choix correct :
                <select name="c_CORR_${index}" class="correct-select">
                  <option value="0">1</option>
                  <option value="1">2</option>
                </select>
              </label>
            </div>
          </div>
        </fieldset>
      `;
      return wrapper;
    }

    function addQuestion() {
      if (count >= maxQ) { alert('Nombre maximum de questions atteint.'); return; }
      const block = createQuestionBlock(count);
      questionsRoot.appendChild(block);
      count++;
      refreshControls();
    }

    function refreshControls() {
      const addButtons = document.querySelectorAll('.add-choice');
      addButtons.forEach(btn => {
        btn.onclick = (e) => {
          const qroot = btn.closest('.choices');
          const qindex = parseInt(qroot.dataset.qindex,10);
          const existing = qroot.querySelectorAll('input[type=text]').length;
          if (existing >= 10) { alert('Max 10 choix par question'); return; }
          const label = document.createElement('label');
          label.innerHTML = `Choix ${existing+1}<input required type="text" name="c_TEXT_${qindex}_${existing}" placeholder="Choix ${existing+1}" />`;
          qroot.insertBefore(label, qroot.querySelector('.choice-controls'));
          // update correct-select
          const select = qroot.querySelector('.correct-select');
          const opt = document.createElement('option');
          opt.value = String(existing);
          opt.textContent = String(existing+1);
          select.appendChild(opt);
        };
      });
    }

    // initial min questions
    for (let i=0;i<minQ;i++) addQuestion();

    document.getElementById('add-question').addEventListener('click', () => addQuestion());
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCreate();
  });
})();
