(() => {
  // 商店 logo（1:1，300×300）。
  // 与工具栏图标同一个标记，但换成「方形头像」的形态：
  // 工具栏图标必须无底色（要同时压在深浅两种工具栏上），
  // 而商店 logo 显示在一张浅色卡片里，没有底色会显得主体偏在角落、立不住。
  function draw(s) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');

    // 深色圆角底，和产品界面同色系，也让黄色更跳
    const r = s * 0.22;
    g.fillStyle = '#20222A';
    g.beginPath();
    g.moveTo(r, 0);
    g.arcTo(s, 0, s, s, r);
    g.arcTo(s, s, 0, s, r);
    g.arcTo(0, s, 0, 0, r);
    g.arcTo(0, 0, s, 0, r);
    g.closePath();
    g.fill();

    // 主体缩进一圈，但笔杆有意从**右侧直边**穿出去 ——
    // 让它在右上圆角处被切断会读成「画错了」，从直边穿出才读成「有意为之」。
    // 所以角度压到 30°，穿出点落在右边中段，离圆角远。
    const P = s * 0.12;
    const S = s - P * 2;
    g.save();
    g.translate(P, P);

    // 一、黄痕
    const y = S * 0.74, h = S * 0.26;
    const x0 = S * 0.00, x1 = S * 0.68;
    const grd = g.createLinearGradient(x0, 0, x1, 0);
    grd.addColorStop(0, 'rgba(255,200,0,.60)');
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

    // 二、笔尖
    const tipX = S * 0.62, tipY = y + h * 0.10;
    const ang = -30 * Math.PI / 180;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const px = -dy, py = dx;
    const L = S * 0.72, halfW = S * 0.165;
    const bx = tipX + dx * L, by = tipY + dy * L;

    g.fillStyle = '#F0D2A2';
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(bx + px * halfW, by + py * halfW);
    g.lineTo(bx - px * halfW, by - py * halfW);
    g.closePath();
    g.fill();

    g.fillStyle = 'rgba(120,84,30,.26)';
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(bx - px * halfW, by - py * halfW);
    g.lineTo(bx, by);
    g.closePath();
    g.fill();

    // 三、石墨尖：它决定这是「一支笔」而不是「一个三角形」
    const gl = L * 0.26, gw = halfW * 0.30;
    const gx = tipX + dx * gl, gy = tipY + dy * gl;
    g.fillStyle = '#15161B';
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(gx + px * gw, gy + py * gw);
    g.lineTo(gx - px * gw, gy - py * gw);
    g.closePath();
    g.fill();

    g.restore();
    return c.toDataURL('image/png');
  }
  return JSON.stringify({ 300: draw(300) });
})()
