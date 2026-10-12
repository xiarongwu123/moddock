'use client';

import React, { useEffect, useRef } from 'react';

const FuzzyText = ({
  children,
  fontSize = 'clamp(2rem, 8vw, 8rem)',
  fontWeight = 900,
  fontFamily = 'inherit',
  color = '#fff',
  enableHover = true,
  baseIntensity = 0.18,
  hoverIntensity = 0.5,
  fuzzRange = 30,
  fps = 60,
  direction = 'horizontal',
  transitionDuration = 0,
  clickEffect = false,
  glitchMode = false,
  glitchInterval = 2000,
  glitchDuration = 200,
  gradient = null,
  letterSpacing = 0,
  className = '',
  paused = false,
  respectReducedMotion = true
}) => {
  const canvasRef = useRef(null);
  const pausedRef = useRef(paused);
  const wakeRef = useRef(null);
  pausedRef.current = paused;
  useEffect(() => { wakeRef.current?.(); }, [paused]);

  useEffect(() => {
    let animationFrameId;
    let isCancelled = false;
    let glitchTimeoutId;
    let glitchEndTimeoutId;
    let clickTimeoutId;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const init = async () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const computedFontFamily =
        fontFamily === 'inherit' ? window.getComputedStyle(canvas).fontFamily || 'sans-serif' : fontFamily;

      const fontSizeStr = typeof fontSize === 'number' ? `${fontSize}px` : fontSize;
      const fontString = `${fontWeight} ${fontSizeStr} ${computedFontFamily}`;

      try {
        await document.fonts.load(fontString);
      } catch {
        await document.fonts.ready;
      }
      if (isCancelled) return;

      let numericFontSize;
      if (typeof fontSize === 'number') {
        numericFontSize = fontSize;
      } else {
        const temp = document.createElement('span');
        temp.style.fontSize = fontSize;
        document.body.appendChild(temp);
        const computedSize = window.getComputedStyle(temp).fontSize;
        numericFontSize = parseFloat(computedSize);
        document.body.removeChild(temp);
      }

      const text = React.Children.toArray(children).join('');

      const offscreen = document.createElement('canvas');
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      offCtx.font = `${fontWeight} ${numericFontSize}px ${computedFontFamily}`;
      offCtx.textBaseline = 'alphabetic';

      let totalWidth = 0;
      if (letterSpacing !== 0) {
        for (const char of text) {
          totalWidth += offCtx.measureText(char).width + letterSpacing;
        }
        totalWidth -= letterSpacing;
      } else {
        totalWidth = offCtx.measureText(text).width;
      }

      const metrics = offCtx.measureText(text);
      const actualLeft = metrics.actualBoundingBoxLeft ?? 0;
      const actualRight = letterSpacing !== 0 ? totalWidth : (metrics.actualBoundingBoxRight ?? metrics.width);
      const actualAscent = metrics.actualBoundingBoxAscent ?? numericFontSize;
      const actualDescent = metrics.actualBoundingBoxDescent ?? numericFontSize * 0.2;

      const textBoundingWidth = Math.ceil(letterSpacing !== 0 ? totalWidth : actualLeft + actualRight);
      const tightHeight = Math.ceil(actualAscent + actualDescent);

      const extraWidthBuffer = 10;
      const offscreenWidth = textBoundingWidth + extraWidthBuffer;

      const scale = Math.min(window.devicePixelRatio || 1, 2);
      offscreen.width = Math.ceil(offscreenWidth * scale);
      offscreen.height = Math.ceil(tightHeight * scale);
      offCtx.scale(scale, scale);

      const xOffset = extraWidthBuffer / 2;
      offCtx.font = `${fontWeight} ${numericFontSize}px ${computedFontFamily}`;
      offCtx.textBaseline = 'alphabetic';

      if (gradient && Array.isArray(gradient) && gradient.length >= 2) {
        const grad = offCtx.createLinearGradient(0, 0, offscreenWidth, 0);
        gradient.forEach((c, i) => grad.addColorStop(i / (gradient.length - 1), c));
        offCtx.fillStyle = grad;
      } else {
        offCtx.fillStyle = color;
      }

      if (letterSpacing !== 0) {
        let xPos = xOffset;
        for (const char of text) {
          offCtx.fillText(char, xPos, actualAscent);
          xPos += offCtx.measureText(char).width + letterSpacing;
        }
      } else {
        offCtx.fillText(text, xOffset - actualLeft, actualAscent);
      }

      const horizontalMargin = fuzzRange + 20;
      const verticalMargin = direction === 'horizontal' ? 0 : fuzzRange + 8;
      const logicalWidth = offscreenWidth + horizontalMargin * 2;
      const logicalHeight = tightHeight + verticalMargin * 2;
      canvas.style.width = `${logicalWidth}px`;
      canvas.style.height = `${logicalHeight}px`;
      canvas.width = Math.ceil(logicalWidth * scale);
      canvas.height = Math.ceil(logicalHeight * scale);
      ctx.scale(scale, scale);
      ctx.translate(horizontalMargin, verticalMargin);

      const interactiveLeft = horizontalMargin + xOffset;
      const interactiveTop = verticalMargin;
      const interactiveRight = interactiveLeft + textBoundingWidth;
      const interactiveBottom = interactiveTop + tightHeight;

      let isHovering = false;
      let isClicking = false;
      let isGlitching = false;
      let currentIntensity = baseIntensity;
      let targetIntensity = baseIntensity;
      let lastFrameTime = 0;
      const frameDuration = 1000 / Math.max(1, fps);
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      let reduced = respectReducedMotion && motion.matches;
      let pageVisible = document.visibilityState !== 'hidden';
      const shouldAnimate = () => !pausedRef.current && pageVisible && !reduced;
      const mixed = direction === 'both' ? document.createElement('canvas') : null;
      if (mixed) { mixed.width = Math.ceil((offscreenWidth + fuzzRange * 2) * scale); mixed.height = offscreen.height; }
      const mixedCtx = mixed?.getContext('2d');
      mixedCtx?.scale(scale, scale);

      const draw = intensity => {
        ctx.clearRect(-horizontalMargin, -verticalMargin, logicalWidth, logicalHeight);
        if (!intensity) {
          ctx.drawImage(offscreen, 0, 0, offscreenWidth, tightHeight);
        } else if (direction === 'horizontal') {
          for (let row = 0; row < tightHeight; row++) {
            const dx = Math.floor(intensity * (Math.random() - 0.5) * fuzzRange);
            ctx.drawImage(offscreen, 0, row * scale, offscreen.width, scale, dx, row, offscreenWidth, 1);
          }
        } else if (direction === 'vertical') {
          for (let column = 0; column < offscreenWidth; column++) {
            const dy = Math.floor(intensity * (Math.random() - 0.5) * fuzzRange);
            ctx.drawImage(offscreen, column * scale, 0, scale, offscreen.height, column, dy, 1, tightHeight);
          }
        } else if (mixedCtx) {
          mixedCtx.clearRect(0, 0, offscreenWidth + fuzzRange * 2, tightHeight);
          for (let row = 0; row < tightHeight; row++) {
            const dx = Math.floor(intensity * (Math.random() - 0.5) * fuzzRange);
            mixedCtx.drawImage(offscreen, 0, row * scale, offscreen.width, scale, fuzzRange + dx, row, offscreenWidth, 1);
          }
          for (let column = 0; column < offscreenWidth + fuzzRange * 2; column++) {
            const dy = Math.floor(intensity * (Math.random() - 0.5) * fuzzRange * 0.5);
            ctx.drawImage(mixed, column * scale, 0, scale, mixed.height, column - fuzzRange, dy, 1, tightHeight);
          }
        }
        canvas.dataset.ready = 'true';
      };

      const startGlitchLoop = () => {
        if (!glitchMode || isCancelled || !shouldAnimate()) return;
        glitchTimeoutId = setTimeout(() => {
          glitchTimeoutId = undefined;
          if (isCancelled || !shouldAnimate()) return;
          isGlitching = true;
          glitchEndTimeoutId = setTimeout(() => {
            isGlitching = false;
            startGlitchLoop();
          }, glitchDuration);
        }, glitchInterval);
      };

      const run = timestamp => {
        animationFrameId = undefined;
        if (isCancelled) return;
        if (!shouldAnimate()) { canvas.dataset.animating = 'false'; draw(0); return; }

        if (timestamp - lastFrameTime < frameDuration) {
          animationFrameId = window.requestAnimationFrame(run);
          return;
        }
        lastFrameTime = timestamp;

        if (isClicking) {
          targetIntensity = 1;
        } else if (isGlitching) {
          targetIntensity = 1;
        } else if (isHovering) {
          targetIntensity = hoverIntensity;
        } else {
          targetIntensity = baseIntensity;
        }

        if (transitionDuration > 0) {
          const step = 1 / (transitionDuration / frameDuration);
          if (currentIntensity < targetIntensity) {
            currentIntensity = Math.min(currentIntensity + step, targetIntensity);
          } else if (currentIntensity > targetIntensity) {
            currentIntensity = Math.max(currentIntensity - step, targetIntensity);
          }
        } else {
          currentIntensity = targetIntensity;
        }

        draw(currentIntensity);
        animationFrameId = window.requestAnimationFrame(run);
      };

      const wake = () => {
        window.cancelAnimationFrame(animationFrameId);
        clearTimeout(glitchTimeoutId); clearTimeout(glitchEndTimeoutId); clearTimeout(clickTimeoutId);
        isGlitching = false; isClicking = false; isHovering = false;
        canvas.dataset.animating = String(shouldAnimate());
        draw(0);
        if (shouldAnimate()) {
          lastFrameTime = 0;
          startGlitchLoop();
          animationFrameId = window.requestAnimationFrame(run);
        }
      };
      wakeRef.current = wake;
      const onVisibility = () => { pageVisible = document.visibilityState !== 'hidden'; wake(); };
      const onMotion = event => { reduced = respectReducedMotion && event.matches; wake(); };
      document.addEventListener('visibilitychange', onVisibility);
      motion.addEventListener('change', onMotion);
      wake();

      const isInsideTextArea = (x, y) => {
        return x >= interactiveLeft && x <= interactiveRight && y >= interactiveTop && y <= interactiveBottom;
      };

      const handleMouseMove = e => {
        if (!enableHover || !shouldAnimate()) return;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * logicalWidth / rect.width;
        const y = (e.clientY - rect.top) * logicalHeight / rect.height;
        isHovering = isInsideTextArea(x, y);
      };

      const handleMouseLeave = () => {
        isHovering = false;
      };

      const handleClick = () => {
        if (!clickEffect || !shouldAnimate()) return;
        isClicking = true;
        clearTimeout(clickTimeoutId);
        clickTimeoutId = setTimeout(() => {
          isClicking = false;
        }, 150);
      };

      const handleTouchMove = e => {
        if (!enableHover || !shouldAnimate()) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = (touch.clientX - rect.left) * logicalWidth / rect.width;
        const y = (touch.clientY - rect.top) * logicalHeight / rect.height;
        isHovering = isInsideTextArea(x, y);
      };

      const handleTouchEnd = () => {
        isHovering = false;
      };

      if (enableHover) {
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseleave', handleMouseLeave);
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
      }

      if (clickEffect) {
        canvas.addEventListener('click', handleClick);
      }

      const cleanup = () => {
        if (wakeRef.current === wake) wakeRef.current = null;
        document.removeEventListener('visibilitychange', onVisibility);
        motion.removeEventListener('change', onMotion);
        window.cancelAnimationFrame(animationFrameId);
        clearTimeout(glitchTimeoutId);
        clearTimeout(glitchEndTimeoutId);
        clearTimeout(clickTimeoutId);
        if (enableHover) {
          canvas.removeEventListener('mousemove', handleMouseMove);
          canvas.removeEventListener('mouseleave', handleMouseLeave);
          canvas.removeEventListener('touchmove', handleTouchMove);
          canvas.removeEventListener('touchend', handleTouchEnd);
        }
        if (clickEffect) {
          canvas.removeEventListener('click', handleClick);
        }
      };

      canvas.cleanupFuzzyText = cleanup;
    };

    init();

    return () => {
      isCancelled = true;
      window.cancelAnimationFrame(animationFrameId);
      clearTimeout(glitchTimeoutId);
      clearTimeout(glitchEndTimeoutId);
      clearTimeout(clickTimeoutId);
      if (canvas && canvas.cleanupFuzzyText) {
        canvas.cleanupFuzzyText();
      }
    };
  }, [
    children,
    fontSize,
    fontWeight,
    fontFamily,
    color,
    enableHover,
    baseIntensity,
    hoverIntensity,
    fuzzRange,
    fps,
    direction,
    transitionDuration,
    clickEffect,
    glitchMode,
    glitchInterval,
    glitchDuration,
    gradient,
    letterSpacing,
    respectReducedMotion
  ]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={React.Children.toArray(children).join('')}>{children}</canvas>;
};

export default FuzzyText;

