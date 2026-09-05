// 书痕图标生成脚本（留档，不进包）。
// 用法：把这段贴进任意页面的 console，或用 CDP 在浏览器里跑，
// 拿 dataURL 写成 icon{16,32,48,128}.png。
//
// 为什么用代码画不用 AI 出图：
// ① 必须在 16px 下还能认出来，AI 出的图细节多，缩小必糊
// ② 配色要和界面一致，程序化才能精确控制
// ③ 改一次要重出四个尺寸，且小尺寸不是等比缩小而是另一套参数
//
// 造型：**笔尖特写 + 一道痕** —— 笔正在划的那一刻。
// 选它不选整支铅笔的理由：铅笔指向「写」，我们做的是「划」；
// 而且铅笔图标在商店里泛滥，一排按钮里最容易被当成别的东西。

(() => {
  function draw(s) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const small = s <= 20;

    // ---- 一、黄痕：左下往右，末端压在笔尖下面 ----
    const y = s * (small ? 0.74 : 0.72);
    const h = s * (small ? 0.30 : 0.24);
    const x0 = s * 0.04;
    const x1 = s * (small ? 0.80 : 0.76);
    const grd = g.createLinearGradient(x0, 0, x1, 0);
    // 起笔端在大尺寸下淡出（像划过来的），小尺寸不敢淡 —— 淡掉那截等于没有
    grd.addColorStop(0, small ? '#FFC800' : 'rgba(255,200,0,.55)');
    grd.addColorStop(0.45, '#FFD400');
    grd.addColorStop(1, '#FFC000');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x0 + h * 0.2, y - h / 2);
    g.arcTo(x1, y - h / 2, x1, y + h / 2, h * 0.18);
    g.arcTo(x1, y + h / 2, x0, y + h / 2, h * 0.18);
    g.arcTo(x0, y + h / 2, x0, y - h / 2, h * 0.2);
    g.arcTo(x0, y - h / 2, x1, y - h / 2, h * 0.2);
    g.closePath();
    g.fill();

    // ---- 二、笔尖：从右上斜插下来，尖端落在黄痕右端 ----
    // 笔身用暖木色不用黄：用黄会和笔痕并成一块，就读不出「笔在划」这层意思。
    // 也不能用深色 —— 深色在 Chrome 深色工具栏上直接消失。
    const tipX = s * (small ? 0.72 : 0.68);
    const tipY = y + h * 0.10;
    const ang = -42 * Math.PI / 180;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const px = -dy, py = dx;
    const L = s * (small ? 1.00 : 0.92);
    const halfW = s * (small ? 0.20 : 0.165);
    const bx = tipX + dx * L, by = tipY + dy * L;

    g.fillStyle = '#F0D2A2';
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(bx + px * halfW, by + py * halfW);
    g.lineTo(bx - px * halfW, by - py * halfW);
    g.closePath();
    g.fill();

    g.fillStyle = 'rgba(150,105,40,.22)';       // 暗面，给锥体厚度
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(bx - px * halfW, by - py * halfW);
    g.lineTo(bx, by);
    g.closePath();
    g.fill();

    // ---- 三、石墨尖 ----
    // 这一小块决定了它是「一支笔」而不是「一个三角形」，不能省。
    const gl = L * (small ? 0.30 : 0.26);
    const gw = halfW * (small ? 0.34 : 0.30);
    const gx = tipX + dx * gl, gy = tipY + dy * gl;
    g.fillStyle = '#2E2F37';
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(gx + px * gw, gy + py * gw);
    g.lineTo(gx - px * gw, gy - py * gw);
    g.closePath();
    g.fill();

    return c.toDataURL('image/png');
  }

  const out = {};
  for (const s of [16, 32, 48, 128]) out[s] = draw(s);
  return JSON.stringify(out);
})()
