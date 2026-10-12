const art = document.getElementById('splash-art');
const loop = document.getElementById('loop');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
let looping = true;
let timer;
let replayId = 0;

function schedule() {
 clearTimeout(timer);
 if (looping && !motion.matches && !document.hidden) timer = setTimeout(replay, 3600);
}
function replay() {
 clearTimeout(timer);
 art.src = `/splash.svg?replay=${Date.now()}-${++replayId}`;
}
function update() {
 const active = looping && !motion.matches;
 loop.disabled = motion.matches;
 loop.setAttribute('aria-pressed', String(active));
 loop.textContent = active ? '循环播放中' : '循环播放';
 schedule();
}
art.addEventListener('load', schedule);
art.addEventListener('error', () => clearTimeout(timer));
document.getElementById('replay').addEventListener('click', replay);
loop.addEventListener('click', () => { looping = !looping; update(); });
motion.addEventListener('change', update);
document.addEventListener('visibilitychange', () => {
 if (!document.hidden && looping && !motion.matches) replay();
 else schedule();
});
update();
