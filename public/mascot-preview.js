const descriptions = {
 idle: ['在呢，随时开工', '挥手问好的匣仔'],
 thinking: ['让我琢磨一下这个点子…', '认真思考的匣仔'],
 working: ['灵感就位，正在动手制作', '忙着制作 Mod 的匣仔'],
 happy: ['做好啦，一起进游戏试试！', '开心庆祝的匣仔'],
};
const mascot = document.querySelector('#mascot');
document.querySelector('.states').addEventListener('click', event => {
 const button = event.target.closest('button[data-state]');
 if (!button) return;
 const mode = button.dataset.state;
 mascot.src = `/youxia-ai-mascot.svg#${mode}`;
 mascot.alt = descriptions[mode][1];
 document.querySelector('#state-label').textContent = descriptions[mode][0];
 document.querySelectorAll('[data-state]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
});
