import * as d3 from 'd3';

const base = import.meta.env.BASE_URL || '/';

document.addEventListener('DOMContentLoaded', function () {
  const width = 1000;
  const height = 1000;
  const margin = 40;
  const labelPadding = 18; // Minimum distance between labels
  const nodeRadius = 10;
  const svg = d3.select('#tsp-vis')
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  d3.json(base + 'example.json').then(function (cities) {
    // Compute min/max for normalization
    const lats = cities.map(d => d.latitude);
    const lons = cities.map(d => d.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Project lat/lon to SVG coordinates with margin
    function project(city) {
      const x = margin + ((city.longitude - minLon) / (maxLon - minLon)) * (width - 2 * margin);
      const y = height - margin - ((city.latitude - minLat) / (maxLat - minLat)) * (height - 2 * margin);
      return { x, y };
    }

    // Draw all possible edges
    const edgeGroup = svg.append('g').attr('class', 'edges');
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = project(cities[i]);
        const b = project(cities[j]);
        edgeGroup.append('line')
          .attr('x1', a.x)
          .attr('y1', a.y)
          .attr('x2', b.x)
          .attr('y2', b.y)
          .attr('class', 'tsp-edge');
      }
    }

    // Group for path edges, always below nodes
    const pathEdgeGroup = svg.insert('g', ':first-child').attr('class', 'path-edges');

    // Group for current node outgoing edges
    const currentEdgeGroup = svg.append('g').attr('class', 'current-edges');

    // Group for hover effects
    const hoverGroup = svg.append('g').attr('class', 'hover-effects');

    // Helper: Euclidean distance
    function distance(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function updateCurrentNodeEdges() {
      currentEdgeGroup.selectAll('*').remove();
      if (tspPath.length === 0) return;
      const currentIdx = tspPath[tspPath.length - 1];
      const current = project(cities[currentIdx]);
      // Collect all unvisited targets with their distances
      let candidates = [];
      for (let i = 0; i < cities.length; i++) {
        if (tspPath.includes(i) || i === currentIdx) continue;
        const target = project(cities[i]);
        const dist = distance(current, target);
        candidates.push({ idx: i, target, dist });
      }
      // Sort by distance and take the three closest
      candidates.sort((a, b) => a.dist - b.dist);
      candidates = candidates.slice(0, 3);
      for (const { idx, target, dist } of candidates) {
        // Draw edge
        currentEdgeGroup.append('line')
          .attr('x1', current.x)
          .attr('y1', current.y)
          .attr('x2', target.x)
          .attr('y2', target.y)
          .attr('data-target-idx', idx);
        // Draw label at midpoint, rotated to match edge
        const midX = (current.x + target.x) / 2;
        const midY = (current.y + target.y) / 2;
        let angle = Math.atan2(target.y - current.y, target.x - current.x) * 180 / Math.PI;
        // Normalize angle to keep text upright
        if (angle > 90 || angle < -90) {
          angle += 180;
        }
        const labelText = dist.toFixed(1);
        // Estimate label width (monospace, 8px per char + 6px padding)
        const labelWidth = labelText.length * 8 + 6;
        const labelHeight = 16;
        // Group for label + background
        const labelGroup = currentEdgeGroup.append('g')
          .attr('transform', `translate(${midX},${midY - 6}) rotate(${angle})`)
          .attr('data-target-idx', idx);
        labelGroup.append('rect')
          .attr('class', 'edge-label-bg')
          .attr('x', -labelWidth / 2)
          .attr('y', -labelHeight / 2)
          .attr('width', labelWidth)
          .attr('height', labelHeight);
        labelGroup.append('text')
          .attr('class', 'edge-label')
          .attr('y', 4)
          .text(labelText);
      }
    }

    // Draw city nodes
    const nodeSelection = svg.selectAll('circle')
      .data(cities)
      .enter()
      .append('circle')
      .attr('class', 'city-node')
      .attr('cx', d => project(d).x)
      .attr('cy', d => project(d).y)
      .attr('r', nodeRadius);

    // --- TSP Path Interactivity ---
    let tspPath = [];
    // --- Undo/Interrupt support ---
    let interrupted = false;
    let asyncActionRunning = false;
    let lastActionStack = [];
    function pushState() {
      lastActionStack.push(tspPath.slice());
      // Limit stack size if desired
      if (lastActionStack.length > 100) lastActionStack.shift();
    }
    function restoreLastState() {
      if (lastActionStack.length > 0) {
        tspPath = lastActionStack.pop();
        updatePathVisuals();
        return true;
      }
      return false;
    }

    function updateRouteLength() {
      const routeLengthDiv = document.getElementById('route-length');
      if (!tspPath.length) {
        routeLengthDiv.textContent = '';
        return;
      }
      let total = 0;
      for (let i = 0; i < tspPath.length - 1; i++) {
        const a = project(cities[tspPath[i]]);
        const b = project(cities[tspPath[i + 1]]);
        total += distance(a, b);
      }
      routeLengthDiv.textContent = `Route length: ${total.toFixed(1)}`;
    }

    function updateNNButtonVisibility() {
      const btn = document.getElementById('btn-nn-complete');
      const btnRandom = document.getElementById('btn-random-complete');
      const btn2opt = document.getElementById('btn-2opt');
      const routeStarted = tspPath.length >= 1;
      const routeComplete = tspPath.length === cities.length + 1;
      
      // Remove all style.display assignments so buttons are always visible
      btn.disabled = !routeStarted || routeComplete;
      btnRandom.disabled = !routeStarted || routeComplete;
      btn2opt.disabled = !routeComplete || !has2OptSwapAvailable();
    }

    function has2OptSwapAvailable() {
      if (tspPath.length < 4) return false;
      
      // Check if any 2-opt swap improves the route
      for (let i = 0; i < tspPath.length - 2; i++) {
        for (let j = i + 2; j < tspPath.length; j++) {
          const a = project(cities[tspPath[i]]);
          const b = project(cities[tspPath[i + 1]]);
          const c = project(cities[tspPath[j]]);
          const d = project(cities[tspPath[(j + 1) % tspPath.length]]);
          
          const currentCost = distance(a, b) + distance(c, d);
          const newCost = distance(a, c) + distance(b, d);
          const improvement = currentCost - newCost;
          
          if (improvement > 0.1) {
            return true;
          }
        }
      }
      return false;
    }

    function updateStartHint() {
      const hint = document.getElementById('start-hint');
      if (tspPath.length === 0) {
        hint.textContent = 'Click on a city to start building your route!';
        hint.classList.remove('hide');
      } else if (tspPath.length === 1) {
        hint.textContent = 'Add another city to the route by clicking it.';
        hint.classList.remove('hide');
      } else if (tspPath.length === 2) {
        hint.textContent = 'Right-click anywhere to undo the last step.';
        hint.classList.remove('hide');
      } else {
        hint.classList.add('hide');
      }
    }

    function updatePathVisuals() {
      pathEdgeGroup.selectAll('line').remove();
      for (let i = 0; i < tspPath.length - 1; i++) {
        const a = project(cities[tspPath[i]]);
        const b = project(cities[tspPath[i + 1]]);
        pathEdgeGroup.append('line')
          .attr('x1', a.x)
          .attr('y1', a.y)
          .attr('x2', b.x)
          .attr('y2', b.y)
          .attr('class', 'path-edge');
      }
      svg.selectAll('circle.city-node')
        .classed('selected', (d, i) => tspPath.includes(i))
        .classed('can-complete', false);
      // Highlight starting node as clickable if all cities are visited (but not yet closed)
      if (tspPath.length === cities.length && tspPath[0] !== tspPath[tspPath.length - 1]) {
        svg.selectAll('circle.city-node')
          .filter((d, i) => i === tspPath[0])
          .classed('can-complete', true);
      }
      updateCurrentNodeEdges();
      updateRouteLength();
      updateNNButtonVisibility();
      updateStartHint();
    }

    nodeSelection.on('click', function(event, d) {
      const idx = cities.indexOf(d);
      if (tspPath.length === 0) {
        tspPath.push(idx);
      } else if (!tspPath.includes(idx)) {
        tspPath.push(idx);
      } else if (
        tspPath.length === cities.length &&
        idx === tspPath[0] &&
        tspPath[0] !== tspPath[tspPath.length - 1]
      ) {
        tspPath.push(idx); // Complete the route
      }
      updatePathVisuals();
    });

    // Add hover functionality to nodes
    nodeSelection.on('mouseenter', function(event, d) {
      const idx = cities.indexOf(d);
      if (tspPath.length === 0 || tspPath.includes(idx)) return;
      
      const currentIdx = tspPath[tspPath.length - 1];
      const current = project(cities[currentIdx]);
      const target = project(d);
      const dist = distance(current, target);
      
      // Highlight the connecting edge
      hoverGroup.append('line')
        .attr('class', 'hover-edge')
        .attr('x1', current.x)
        .attr('y1', current.y)
        .attr('x2', target.x)
        .attr('y2', target.y);
      
      // Show distance label
      const midX = (current.x + target.x) / 2;
      const midY = (current.y + target.y) / 2;
      let angle = Math.atan2(target.y - current.y, target.x - current.x) * 180 / Math.PI;
      if (angle > 90 || angle < -90) {
        angle += 180;
      }
      const labelText = dist.toFixed(1);
      const labelWidth = labelText.length * 8 + 12;
      const labelHeight = 20;
      
      const hoverLabelGroup = hoverGroup.append('g')
        .attr('transform', `translate(${midX},${midY - 8}) rotate(${angle})`);
      hoverLabelGroup.append('rect')
        .attr('class', 'hover-label-bg')
        .attr('x', -labelWidth / 2)
        .attr('y', -labelHeight / 2)
        .attr('width', labelWidth)
        .attr('height', labelHeight);
      hoverLabelGroup.append('text')
        .attr('class', 'hover-label')
        .attr('y', 6)
        .text(labelText);
    });

    nodeSelection.on('mouseleave', function(event, d) {
      hoverGroup.selectAll('*').remove();
    });

    // --- Force simulation for labels ---
    // Each label is a node, linked to its city
    const labelNodes = cities.map((d, i) => {
      const p = project(d);
      return {
        index: i,
        name: d.name,
        x: p.x,
        y: p.y - 15, // initial offset above
        fx: null,
        fy: null
      };
    });
    const cityNodes = cities.map((d, i) => {
      const p = project(d);
      return {
        index: i,
        x: p.x,
        y: p.y
      };
    });
    const links = labelNodes.map((label, i) => ({
      source: i,
      target: i,
      strength: 1
    }));

    // Custom force to repel labels from all city nodes except their own
    function labelNodeRepel(alpha) {
      for (let i = 0; i < labelNodes.length; i++) {
        const label = labelNodes[i];
        for (let j = 0; j < cityNodes.length; j++) {
          if (i === j) continue; // skip own city
          const node = cityNodes[j];
          let dx = label.x - node.x;
          let dy = label.y - node.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = nodeRadius + labelPadding;
          if (dist < minDist && dist > 0.01) {
            const move = (minDist - dist) * 0.5 * alpha;
            dx /= dist;
            dy /= dist;
            label.x += dx * move;
            label.y += dy * move;
          }
        }
      }
    }

    const simulation = d3.forceSimulation(labelNodes)
      .force('link', d3.forceLink(links).distance(25).strength(1).iterations(10))
      .force('collide', d3.forceCollide(labelPadding))
      .force('x', d3.forceX((d, i) => cityNodes[i].x).strength(0.2))
      .force('y', d3.forceY((d, i) => cityNodes[i].y - 15).strength(0.2))
      .alphaDecay(0.03)
      .on('tick', () => labelNodeRepel(0.5));

    // Run simulation for a fixed number of ticks
    for (let i = 0; i < 100; i++) simulation.tick();

    // --- Post-process: ensure no label overlaps any node (including its own) ---
    for (let i = 0; i < labelNodes.length; i++) {
      const label = labelNodes[i];
      for (let j = 0; j < cityNodes.length; j++) {
        const node = cityNodes[j];
        let dx = label.x - node.x;
        let dy = label.y - node.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = nodeRadius + labelPadding;
        if (dist < minDist && dist > 0.01) {
          // Move label radially outward from node
          const move = (minDist - dist) + 1;
          dx /= dist;
          dy /= dist;
          label.x += dx * move;
          label.y += dy * move;
        }
      }
    }

    // Draw city labels with pretty backgrounds
    const labelGroups = svg.selectAll('g.city-label-group')
      .data(labelNodes)
      .enter()
      .append('g')
      .attr('class', 'city-label-group')
      .attr('transform', d => `translate(${d.x},${d.y})`);

    labelGroups.append('rect')
      .attr('class', 'city-label-bg')
      .attr('x', function(d) {
        // Estimate width based on text length (monospace, 8px per char + 8px padding)
        return -((d.name.length * 8 + 8) / 2);
      })
      .attr('y', -12)
      .attr('width', d => d.name.length * 8 + 8)
      .attr('height', 20);

    labelGroups.append('text')
      .attr('class', 'city-label')
      .attr('y', 0)
      .text(d => d.name);

    // Nearest Neighbour completion logic
    async function animateNearestNeighbourCompletion() {
      const btn = document.getElementById('btn-nn-complete');
      btn.disabled = true;
      if (!tspPath.length || tspPath.length === cities.length + 1) {
        btn.disabled = false;
        updateNNButtonVisibility();
        return;
      }
      asyncActionRunning = true;
      interrupted = false;
      let visited = new Set(tspPath);
      let currentIdx = tspPath[tspPath.length - 1];
      while (visited.size < cities.length) {
        if (interrupted) break;
        let minDist = Infinity;
        let nextIdx = -1;
        const current = project(cities[currentIdx]);
        for (let i = 0; i < cities.length; i++) {
          if (visited.has(i)) continue;
          const candidate = project(cities[i]);
          const dist = distance(current, candidate);
          if (dist < minDist) {
            minDist = dist;
            nextIdx = i;
          }
        }
        if (nextIdx === -1) break;
        // Push state before adding city
        pushState();
        // Animate edge
        const target = project(cities[nextIdx]);
        pathEdgeGroup.append('line')
          .attr('x1', current.x)
          .attr('y1', current.y)
          .attr('x2', target.x)
          .attr('y2', target.y)
          .attr('class', 'autocompleted-edge');
        // Animate node highlight
        svg.selectAll('circle.city-node')
          .filter((d, i) => i === nextIdx)
          .classed('autocompleted-node', true);
        tspPath.push(nextIdx);
        visited.add(nextIdx);
        currentIdx = nextIdx;
        updateRouteLength();
        updateCurrentNodeEdges();
        await new Promise(res => setTimeout(res, 500));
        if (interrupted) break;
      }
      // Close the route if not already closed
      if (!interrupted && tspPath.length && tspPath[0] !== tspPath[tspPath.length - 1]) {
        pushState();
        const a = project(cities[tspPath[tspPath.length - 1]]);
        const b = project(cities[tspPath[0]]);
        pathEdgeGroup.append('line')
          .attr('x1', a.x)
          .attr('y1', a.y)
          .attr('x2', b.x)
          .attr('y2', b.y)
          .attr('class', 'autocompleted-edge');
        tspPath.push(tspPath[0]);
        updateRouteLength();
        updateCurrentNodeEdges();
        await new Promise(res => setTimeout(res, 500));
      }
      // Clean up: remove animation classes and redraw final visuals
      svg.selectAll('circle.city-node').classed('autocompleted-node', false);
      updatePathVisuals();
      btn.disabled = false;
      updateNNButtonVisibility();
      asyncActionRunning = false;
    }

    document.getElementById('btn-nn-complete').addEventListener('click', animateNearestNeighbourCompletion);
    updateNNButtonVisibility();
    updateStartHint();

    // 2-opt optimization logic
    async function optimizeWith2Opt() {
      const btn = document.getElementById('btn-2opt');
      btn.disabled = true;
      if (tspPath.length < 4) {
        btn.disabled = false;
        return;
      }
      pushState();
      asyncActionRunning = true;
      interrupted = false;
      let improved = true;
      while (improved) {
        if (interrupted) break;
        improved = false;
        let bestImprovement = 0;
        let bestSwap = null;
        // Find the best 2-opt swap
        for (let i = 0; i < tspPath.length - 2; i++) {
          for (let j = i + 2; j < tspPath.length; j++) {
            const a = project(cities[tspPath[i]]);
            const b = project(cities[tspPath[i + 1]]);
            const c = project(cities[tspPath[j]]);
            const d = project(cities[tspPath[(j + 1) % tspPath.length]]);
            const currentCost = distance(a, b) + distance(c, d);
            const newCost = distance(a, c) + distance(b, d);
            const improvement = currentCost - newCost;
            if (improvement > bestImprovement) {
              bestImprovement = improvement;
              bestSwap = { i, j };
            }
          }
        }
        // Apply the best swap if it improves the route
        if (bestSwap && bestImprovement > 0.1) {
          const { i, j } = bestSwap;
          // Highlight edges to be removed (red)
          const a = project(cities[tspPath[i]]);
          const b = project(cities[tspPath[i + 1]]);
          const c = project(cities[tspPath[j]]);
          const d = project(cities[tspPath[(j + 1) % tspPath.length]]);
          hoverGroup.append('line')
            .attr('class', 'swap-remove')
            .attr('x1', a.x)
            .attr('y1', a.y)
            .attr('x2', b.x)
            .attr('y2', b.y);
          hoverGroup.append('line')
            .attr('class', 'swap-remove')
            .attr('x1', c.x)
            .attr('y1', c.y)
            .attr('x2', d.x)
            .attr('y2', d.y);
          // Highlight edges to be added (green)
          hoverGroup.append('line')
            .attr('class', 'swap-add')
            .attr('x1', a.x)
            .attr('y1', a.y)
            .attr('x2', c.x)
            .attr('y2', c.y);
          hoverGroup.append('line')
            .attr('class', 'swap-add')
            .attr('x1', b.x)
            .attr('y1', b.y)
            .attr('x2', d.x)
            .attr('y2', d.y);
          // Wait for highlight animation
          await new Promise(res => setTimeout(res, 1000));
          if (interrupted) break;
          // Clear highlights
          hoverGroup.selectAll('*').remove();
          // Reverse the segment from i+1 to j
          const segment = tspPath.slice(i + 1, j + 1).reverse();
          tspPath.splice(i + 1, j - i, ...segment);
          // Animate the swap
          updatePathVisuals();
          // Highlight the resulting edges (green to blue transition)
          const newA = project(cities[tspPath[i]]);
          const newB = project(cities[tspPath[i + 1]]);
          const newC = project(cities[tspPath[j]]);
          const newD = project(cities[tspPath[(j + 1) % tspPath.length]]);
          hoverGroup.append('line')
            .attr('class', 'swap-result')
            .attr('x1', newA.x)
            .attr('y1', newA.y)
            .attr('x2', newB.x)
            .attr('y2', newB.y);
          hoverGroup.append('line')
            .attr('class', 'swap-result')
            .attr('x1', newC.x)
            .attr('y1', newC.y)
            .attr('x2', newD.x)
            .attr('y2', newD.y);
          await new Promise(res => setTimeout(res, 1000));
          if (interrupted) break;
          improved = true;
        }
      }
      // Keep button disabled after optimization is complete
      btn.disabled = true;
      // Clean up lingering highlights after 2-opt
      hoverGroup.selectAll('*').remove();
      asyncActionRunning = false;
    }

    document.getElementById('btn-2opt').addEventListener('click', optimizeWith2Opt);

    // Random completion logic
    async function completeRandomly() {
      const btn = document.getElementById('btn-random-complete');
      btn.disabled = true;
      if (!tspPath.length || tspPath.length === cities.length + 1) {
        btn.disabled = false;
        return;
      }
      asyncActionRunning = true;
      interrupted = false;
      let visited = new Set(tspPath);
      let currentIdx = tspPath[tspPath.length - 1];
      while (visited.size < cities.length) {
        if (interrupted) break;
        // Get all unvisited cities
        const unvisited = [];
        for (let i = 0; i < cities.length; i++) {
          if (!visited.has(i)) unvisited.push(i);
        }
        // Randomly select next city
        const nextIdx = unvisited[Math.floor(Math.random() * unvisited.length)];
        const current = project(cities[currentIdx]);
        const target = project(cities[nextIdx]);
        // Push state before adding city
        pushState();
        // Animate edge
        pathEdgeGroup.append('line')
          .attr('x1', current.x)
          .attr('y1', current.y)
          .attr('x2', target.x)
          .attr('y2', target.y)
          .attr('class', 'autocompleted-edge');
        // Animate node highlight
        svg.selectAll('circle.city-node')
          .filter((d, i) => i === nextIdx)
          .classed('autocompleted-node', true);
        tspPath.push(nextIdx);
        visited.add(nextIdx);
        currentIdx = nextIdx;
        updateRouteLength();
        updateCurrentNodeEdges();
        await new Promise(res => setTimeout(res, 250));
        if (interrupted) break;
      }
      // Close the route if not already closed
      if (!interrupted && tspPath.length && tspPath[0] !== tspPath[tspPath.length - 1]) {
        pushState();
        const a = project(cities[tspPath[tspPath.length - 1]]);
        const b = project(cities[tspPath[0]]);
        pathEdgeGroup.append('line')
          .attr('x1', a.x)
          .attr('y1', a.y)
          .attr('x2', b.x)
          .attr('y2', b.y)
          .attr('class', 'autocompleted-edge');
        tspPath.push(tspPath[0]);
        updateRouteLength();
        updateCurrentNodeEdges();
        await new Promise(res => setTimeout(res, 250));
      }
      // Clean up: remove animation classes and redraw final visuals
      svg.selectAll('circle.city-node').classed('autocompleted-node', false);
      updatePathVisuals();
      btn.disabled = false;
      updateNNButtonVisibility();
      asyncActionRunning = false;
    }

    document.getElementById('btn-random-complete').addEventListener('click', completeRandomly);

    // Remove last city from route on right-click
    document.addEventListener('contextmenu', function(event) {
      event.preventDefault();
      if (asyncActionRunning) {
        interrupted = true;
        return;
      }
      if (restoreLastState()) {
        return;
      }
      if (tspPath.length > 0) {
        tspPath.pop();
        updatePathVisuals();
      }
    });
  });
});
