const art = document.getElementById('splash-art');
document.getElementById('replay').addEventListener('click', () => {
 art.src = `/splash.svg?replay=${Date.now()}`;
});
