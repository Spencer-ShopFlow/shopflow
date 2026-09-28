// ============================================
// CHART HELPERS (Sprint 14.0)
// Shared SVG chart rendering (currently unused; see Master Plan 5-13)
// (Sprint 14) and class analytics (Sprint 18).
// ============================================


function renderLineChart(container, lines, options = {}) {
    if (!container) return;
    container.innerHTML = '';

    const {
        xLabels = [],
        height = 280,
        yMin = 0,
        yMax: userYMax,
        yTicks: userYTicks,
        yLabel = '',
        xLabel = '',
        legend = true,
        pointRadius = 4,
        tooltips = true
    } = options;

    if (xLabels.length === 0 || lines.length === 0) {
        container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No data to chart.</p>';
        return;
    }

    const width = container.clientWidth || 600;
    const margin = { top: 20, right: legend ? 120 : 20, bottom: 60, left: 50 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    let dataMax = 0;
    lines.forEach(line => {
        line.values.forEach(v => {
            if (v != null && v > dataMax) dataMax = v;
        });
    });
    const yMaxVal = userYMax != null ? userYMax : Math.max(dataMax, 1);
    const yTicks = userYTicks || generateTicks(yMin, yMaxVal, 5);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.style.display = 'block';
    svg.style.touchAction = 'pan-y';

    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('width', width);
    bg.setAttribute('height', height);
    bg.setAttribute('fill', 'transparent');
    svg.appendChild(bg);

    yTicks.forEach(tick => {
        const y = margin.top + chartH - ((tick - yMin) / (yMaxVal - yMin)) * chartH;

        const gridline = document.createElementNS(svgNS, 'line');
        gridline.setAttribute('x1', margin.left);
        gridline.setAttribute('x2', margin.left + chartW);
        gridline.setAttribute('y1', y);
        gridline.setAttribute('y2', y);
        gridline.setAttribute('stroke', 'var(--color-border)');
        gridline.setAttribute('stroke-width', '1');
        gridline.setAttribute('opacity', '0.5');
        svg.appendChild(gridline);

        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', margin.left - 8);
        label.setAttribute('y', y + 4);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('font-size', '11');
        label.setAttribute('fill', 'var(--color-text-tertiary)');
        label.textContent = tick;
        svg.appendChild(label);
    });

    if (yLabel) {
        const yLabelEl = document.createElementNS(svgNS, 'text');
        yLabelEl.setAttribute('transform', `rotate(-90)`);
        yLabelEl.setAttribute('x', -(margin.top + chartH / 2));
        yLabelEl.setAttribute('y', 14);
        yLabelEl.setAttribute('text-anchor', 'middle');
        yLabelEl.setAttribute('font-size', '12');
        yLabelEl.setAttribute('fill', 'var(--color-text-secondary)');
        yLabelEl.textContent = yLabel;
        svg.appendChild(yLabelEl);
    }

    const xStep = xLabels.length > 1 ? chartW / (xLabels.length - 1) : chartW / 2;
    const maxLabelChars = chartW / xLabels.length < 60 ? 8 : 14;
    xLabels.forEach((label, i) => {
        const x = margin.left + (xLabels.length > 1 ? i * xStep : chartW / 2);
        const y = margin.top + chartH + 16;
        const truncated = label.length > maxLabelChars ? label.substring(0, maxLabelChars) + '…' : label;

        const labelEl = document.createElementNS(svgNS, 'text');
        labelEl.setAttribute('x', x);
        labelEl.setAttribute('y', y);
        labelEl.setAttribute('text-anchor', xLabels.length <= 4 ? 'middle' : 'end');
        labelEl.setAttribute('font-size', '10');
        labelEl.setAttribute('fill', 'var(--color-text-tertiary)');
        if (xLabels.length > 4) {
            labelEl.setAttribute('transform', `rotate(-30, ${x}, ${y})`);
        }
        labelEl.textContent = truncated;
        svg.appendChild(labelEl);
    });

    if (xLabel) {
        const xLabelEl = document.createElementNS(svgNS, 'text');
        xLabelEl.setAttribute('x', margin.left + chartW / 2);
        xLabelEl.setAttribute('y', height - 4);
        xLabelEl.setAttribute('text-anchor', 'middle');
        xLabelEl.setAttribute('font-size', '12');
        xLabelEl.setAttribute('fill', 'var(--color-text-secondary)');
        xLabelEl.textContent = xLabel;
        svg.appendChild(xLabelEl);
    }

    const tooltipGroup = document.createElementNS(svgNS, 'g');
    tooltipGroup.setAttribute('id', 'chart-tooltip');
    tooltipGroup.style.display = 'none';
    const tooltipBg = document.createElementNS(svgNS, 'rect');
    tooltipBg.setAttribute('rx', '4');
    tooltipBg.setAttribute('ry', '4');
    tooltipBg.setAttribute('fill', 'var(--color-text-primary)');
    tooltipBg.setAttribute('opacity', '0.85');
    tooltipGroup.appendChild(tooltipBg);
    const tooltipText = document.createElementNS(svgNS, 'text');
    tooltipText.setAttribute('fill', 'var(--color-background)');
    tooltipText.setAttribute('font-size', '11');
    tooltipText.setAttribute('font-weight', '600');
    tooltipGroup.appendChild(tooltipText);

    lines.forEach((line, lineIdx) => {
        const color = line.color || CHART_COLORS.series[lineIdx % CHART_COLORS.series.length];
        const strokeDash = line.strokeDash != null ? line.strokeDash : (CHART_STROKES.series[lineIdx % CHART_STROKES.series.length]);

        let pathD = '';
        let prevValid = false;

        line.values.forEach((val, i) => {
            if (val == null) {
                prevValid = false;
                return;
            }
            const x = margin.left + (xLabels.length > 1 ? i * xStep : chartW / 2);
            const y = margin.top + chartH - ((val - yMin) / (yMaxVal - yMin)) * chartH;

            if (!prevValid) {
                pathD += `M ${x} ${y} `;
            } else {
                pathD += `L ${x} ${y} `;
            }
            prevValid = true;
        });

        if (pathD) {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', pathD);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '2.5');
            if (strokeDash) path.setAttribute('stroke-dasharray', strokeDash);
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(path);
        }

        line.values.forEach((val, i) => {
            if (val == null) return;
            const x = margin.left + (xLabels.length > 1 ? i * xStep : chartW / 2);
            const y = margin.top + chartH - ((val - yMin) / (yMaxVal - yMin)) * chartH;

            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', pointRadius);
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', 'var(--color-background)');
            circle.setAttribute('stroke-width', '2');
            circle.style.cursor = 'pointer';

            if (tooltips) {
                const showTooltip = () => {
                    tooltipText.textContent = `${line.label}: ${val}`;
                    const textLen = tooltipText.textContent.length * 6.5 + 12;
                    tooltipBg.setAttribute('width', textLen);
                    tooltipBg.setAttribute('height', 22);
                    tooltipBg.setAttribute('x', x - textLen / 2);
                    tooltipBg.setAttribute('y', y - 32);
                    tooltipText.setAttribute('x', x);
                    tooltipText.setAttribute('y', y - 17);
                    tooltipText.setAttribute('text-anchor', 'middle');
                    tooltipGroup.style.display = '';
                };
                const hideTooltip = () => { tooltipGroup.style.display = 'none'; };

                circle.addEventListener('mouseenter', showTooltip);
                circle.addEventListener('mouseleave', hideTooltip);
                circle.addEventListener('touchstart', (e) => { e.preventDefault(); showTooltip(); });
                circle.addEventListener('touchend', hideTooltip);
            }

            svg.appendChild(circle);
        });
    });

    svg.appendChild(tooltipGroup);

    if (legend && lines.length > 1) {
        let legendY = margin.top + 4;
        lines.forEach((line, lineIdx) => {
            const color = line.color || CHART_COLORS.series[lineIdx % CHART_COLORS.series.length];
            const strokeDash = line.strokeDash != null ? line.strokeDash : (CHART_STROKES.series[lineIdx % CHART_STROKES.series.length]);
            const legendX = margin.left + chartW + 12;

            const sampleLine = document.createElementNS(svgNS, 'line');
            sampleLine.setAttribute('x1', legendX);
            sampleLine.setAttribute('x2', legendX + 20);
            sampleLine.setAttribute('y1', legendY + 6);
            sampleLine.setAttribute('y2', legendY + 6);
            sampleLine.setAttribute('stroke', color);
            sampleLine.setAttribute('stroke-width', '2.5');
            if (strokeDash) sampleLine.setAttribute('stroke-dasharray', strokeDash);
            svg.appendChild(sampleLine);

            const legendLabel = document.createElementNS(svgNS, 'text');
            legendLabel.setAttribute('x', legendX + 26);
            legendLabel.setAttribute('y', legendY + 10);
            legendLabel.setAttribute('font-size', '11');
            legendLabel.setAttribute('fill', 'var(--color-text-secondary)');
            legendLabel.textContent = line.label;
            svg.appendChild(legendLabel);

            legendY += 20;
        });
    }

    container.appendChild(svg);
}

function renderBarChart(container, data, options = {}) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Bar chart — coming in Sprint 18.</p>';
        }

        function renderHistogram(container, data, options = {}) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Histogram — coming in Sprint 18.</p>';
        }

        function generateTicks(min, max, count) {
            const ticks = [];
            const step = (max - min) / (count - 1);
            for (let i = 0; i < count; i++) {
                ticks.push(Math.round((min + step * i) * 10) / 10);
            }
            return ticks;
        }