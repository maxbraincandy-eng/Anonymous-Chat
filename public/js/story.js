// ინსტაგრამის სთორის ბარათის გენერაცია (1080×1920 PNG) — მთლიანად ბრაუზერში, canvas-ით

function storyRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ტექსტის დაყოფა ხაზებად, სიგანის მიხედვით (გრძელი სიტყვები სიმბოლოებად იჭრება)
function storyWrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const rawLine of text.split('\n')) {
    let line = '';
    for (const word of rawLine.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // ცალკე სიტყვაც არ ეტევა — დავჭრათ
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

function buildStoryCanvas({ content, link }) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ფონი — ბრენდის გრადიენტი
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#1a0533');
  bg.addColorStop(0.55, '#3b0a5e');
  bg.addColorStop(1, '#12042a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // დეკორატიული ნათებები
  const glow1 = ctx.createRadialGradient(W * 0.85, H * 0.18, 0, W * 0.85, H * 0.18, 500);
  glow1.addColorStop(0, 'rgba(255, 46, 147, 0.35)');
  glow1.addColorStop(1, 'rgba(255, 46, 147, 0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(W * 0.1, H * 0.85, 0, W * 0.1, H * 0.85, 600);
  glow2.addColorStop(0, 'rgba(138, 43, 226, 0.4)');
  glow2.addColorStop(1, 'rgba(138, 43, 226, 0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = 'center';

  // შეტყობინების ტექსტი — ზომას სიგრძეზე ვარგებთ
  let text = content.trim();
  if (text.length > 320) text = text.slice(0, 320) + '…';
  let fontSize = text.length < 60 ? 64 : text.length < 140 ? 54 : 44;
  const cardW = 900;
  const cardX = (W - cardW) / 2;
  const textMaxW = cardW - 130;
  let lines;
  while (true) {
    ctx.font = `700 ${fontSize}px ${FONT}`;
    lines = storyWrapText(ctx, text, textMaxW);
    if (lines.length <= 12 || fontSize <= 34) break;
    fontSize -= 4;
  }
  const lineH = Math.round(fontSize * 1.35);

  // თეთრი ბარათი
  const labelH = 120;
  const cardH = labelH + lines.length * lineH + 90;
  const cardY = (H - cardH) / 2 - 120;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  storyRoundRect(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // ბარათის სათაური
  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = '#8a8595';
  ctx.fillText('🕵️ ანონიმური შეტყობინება', W / 2, cardY + 78);

  // შეტყობინება
  ctx.font = `700 ${fontSize}px ${FONT}`;
  ctx.fillStyle = '#1a0533';
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, cardY + labelH + (i + 0.8) * lineH);
  });

  // CTA
  ctx.font = `800 50px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('მიპასუხე ანონიმურად 👀', W / 2, cardY + cardH + 130);

  // ლინკის ღილაკი
  ctx.font = `700 38px ${FONT}`;
  const linkText = link.replace(/^https?:\/\//, '');
  const pillW = Math.min(ctx.measureText(linkText).width + 120, W - 120);
  const pillH = 92;
  const pillX = (W - pillW) / 2;
  const pillY = cardY + cardH + 180;
  const pillGrad = ctx.createLinearGradient(pillX, 0, pillX + pillW, 0);
  pillGrad.addColorStop(0, '#ff2e93');
  pillGrad.addColorStop(1, '#8a2be2');
  storyRoundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = pillGrad;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(linkText, W / 2, pillY + 60);

  // ბრენდინგი ბოლოში
  ctx.font = `600 30px ${FONT}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillText('ანონიმო · powered by ბატონი მაქსი ⚡', W / 2, H - 90);

  return canvas;
}

// გაზიარება: ტელეფონზე — share sheet (Instagram Stories პირდაპირ სიაშია), სხვაგან — ჩამოტვირთვა
async function shareStoryImage({ content, link }, btn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'იქმნება...';
  try {
    const canvas = buildStoryCanvas({ content, link });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'anonimo-story.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        btn.textContent = 'გაზიარდა ✓';
        return;
      } catch (e) {
        if (e.name === 'AbortError') { btn.textContent = old; return; }
        // share ვერ გამოვიდა — გადავდივართ ჩამოტვირთვაზე
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'anonimo-story.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    btn.textContent = 'ჩამოიტვირთა ✓';
  } catch (e) {
    btn.textContent = 'შეცდომა 😔';
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = old; }, 2500);
  }
}
