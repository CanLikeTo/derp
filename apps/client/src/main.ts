import {
  initializePhysics,
  fixtureTrace,
  replay,
  TICK_MS,
  MOVEMENT,
  JETS,
  aimQToDegrees,
  type Trace,
} from "@derp/simulation";
import {
  BUILD_ID,
  CONTENT_VERSION,
  PROTOCOL_VERSION,
  LIMITS,
  parseServer,
  Samples,
  type ClientMessage,
  type StateMessage,
} from "@derp/protocol";
import { Prediction, Interpolation } from "./prediction";
import { predictionLead, SchedulingJitter, ServerClock } from "./timing";
import { Controls, PointerAim, type WorldPoint } from "./input";
import { DelayQueue, PRESETS, type Preset } from "./network";
import { View } from "./view";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;
try {
  await initializePhysics();
  if (new URLSearchParams(location.search).has("compat")) {
    const states = replay(fixtureTrace());
    app.textContent = JSON.stringify({
      gate: "browser-rapier",
      passed: true,
      final: states.at(-1),
      states,
    });
  } else start();
} catch (error) {
  app.textContent = `Cannot start dERP. WebGL2 and WebAssembly are required. ${error instanceof Error ? error.message : error}`;
}

function start() {
  app.innerHTML = `
    <header class="header"><div class="brand">dERP<span>LAB</span></div><div class="build-label">PLAYGROUND / 001<br><span>AUTHORITATIVE MOVEMENT LAB</span></div><div class="local-badge"><i></i> LOCAL ONLY</div></header>
    <section class="intro"><h1>Small room. <em>Big plans.</em></h1><p>Two players. One server. Absolutely no explosions. Yet.</p></section>
    <div class="layout"><section class="arena-panel"><div class="panel-heading"><span>01 / TEST CHAMBER</span><span id="occupancy">0 / 2 PLAYERS</span></div>
      <div id="viewport" tabindex="0" role="application" aria-label="Playground. Move the mouse to aim. A or D moves, Space jumps, and either Shift key thrusts when jets are enabled."><div class="arena-watermark" aria-hidden="true">dERP<br><small>WORK IN PROGRESS</small></div></div>
      <div class="arena-footer"><span><kbd>MOUSE</kbd> AIM <span class="divider">/</span> <kbd>A</kbd><kbd>D</kbd> MOVE <span class="divider">/</span> <kbd>SPACE</kbd> JUMP <span class="divider">/</span> <kbd>SHIFT</kbd> JET</span><span id="focus-label">CLICK CONNECT TO ENTER</span></div>
      <div class="readouts"><div><span>SERVER</span><strong id="tick">—</strong><small>60 Hz fixed simulation</small></div><div><span>ROUND TRIP</span><strong id="rtt">—</strong><small>Measured, including added delay</small></div><div><span>CORRECTION P95</span><strong id="correction">—</strong><small>Compared at the same tick</small></div></div>
    </section><aside>
      <section class="control-panel"><div class="panel-heading">02 / CONNECTION</div><div id="status" role="status" aria-live="polite">Disconnected</div><p class="muted">Open a second window at this address to add another player.</p><button id="connect" class="primary">Connect <span>↗</span></button><div class="button-row"><button id="disconnect">Disconnect</button><button id="reconnect">Reconnect</button></div><button id="reset" disabled>Reset playground <span>↺</span></button></section>
      <section class="control-panel"><div class="panel-heading">03 / JET EXPERIMENT</div><button id="jets" disabled>Enable jets · resets both players</button><label for="fuel" id="fuel-label">Jets off</label><progress id="fuel" max="45" value="45" aria-label="Jet fuel"></progress><p class="muted small">Hold either Shift for thrust. Release both on the ground to refill. Space still jumps.</p></section>
      <section class="control-panel"><div class="panel-heading">04 / NETWORK LAB</div><label for="latency">Added round-trip latency</label><select id="latency"><option value="local">0 ms · Local</option><option value="routine">100 ms · ±20 ms jitter</option><option value="degraded">200 ms · ±40 ms jitter</option></select><p class="muted small">Seeded application delay. Ordered delivery. This does not simulate TCP packet loss.</p><label class="checkbox"><input id="debug" type="checkbox"> Show collision / server ghost</label><p class="muted small">The ghost is a historical server pose, not a prediction-error marker.</p></section>
      <section class="control-panel"><div class="panel-heading">05 / EVIDENCE</div><button id="export">Export diagnostics <span>↓</span></button><details><summary>Live diagnostics</summary><pre id="diagnostics"></pre></details></section>
    </aside></div><footer class="footer"><span>BUN + THREE.JS + RAPIER</span><span>NO ACCOUNTS. NO PUBLIC SERVER. JUST THE FOUNDATION.</span></footer>`;
  const element = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const viewport = element("viewport");
  const view = new View(viewport);
  const prediction = new Prediction(),
    interpolation = new Interpolation(),
    controls = new Controls(),
    pointer = new PointerAim();
  const frames = new Samples(),
    rtts = new Samples(120);
  let socket: WebSocket | undefined,
    generation = 0,
    preset: Preset = "local";
  let status = "Disconnected",
    active = false,
    syncing = false,
    playerId = "",
    lead = 2,
    rtt = 0;
  const clock = new ServerClock();
  const scheduling = new SchedulingJitter();
  let lastFrame = performance.now(),
    lastSnapshotAt = 0,
    syncAt = 0;
  let latest: StateMessage | undefined,
    receivedBytes = 0,
    sentBytes = 0,
    resyncs = 0;
  let firstTick = 0,
    started = performance.now(),
    lastPing = 0,
    nonce = 0;
  let timingReady = false,
    calibrating = false,
    calibrationSamples = 0;
  let controlAt = -Infinity;
  let currentPointerTarget: WorldPoint | undefined,
    reticleVisible = false;
  const pendingPings = new Map<number, number>();
  const events: { at: number; event: string }[] = [];
  const note = (event: string) => {
    events.push({ at: performance.now() - started, event });
    if (events.length > 100) events.shift();
  };
  const outgoing = new DelayQueue(
    preset,
    () => disconnect("Outgoing delay queue exhausted"),
    observeScheduling,
  );
  const incoming = new DelayQueue(
    preset,
    () => disconnect("Incoming delay queue exhausted"),
    observeScheduling,
  );
  const desiredLead = () =>
    predictionLead(rtt, PRESETS[preset].jitter + scheduling.allowance);
  function observeScheduling(lateness: number) {
    scheduling.observe(lateness);
    if (timingReady && !syncing) {
      const next = Math.max(lead, desiredLead());
      if (next !== lead)
        prediction.timing.add({
          stage: "scheduling",
          at: performance.now(),
          lateness,
          allowance: scheduling.allowance,
          lead: next,
        });
      lead = next;
    }
  }
  const serverTick = () => clock.tick(performance.now());
  function setStatus(value: string) {
    status = value;
    element("status").textContent = value;
    refreshControlButtons();
  }
  function send(message: ClientMessage) {
    const current = socket;
    const ownGeneration = generation;
    if (message.type === "input")
      prediction.timing.add({
        stage: "generated",
        playerId,
        inputEpoch: message.inputEpoch,
        tick: message.tick,
        at: performance.now(),
        lead,
        schedulingJitterMs: scheduling.allowance,
        estimatedServerTick: serverTick(),
      });
    outgoing.enqueue(() => {
      if (
        ownGeneration !== generation ||
        current?.readyState !== WebSocket.OPEN
      )
        return;
      if (current.bufferedAmount > 16384) {
        disconnect("Outgoing connection congested; reconnect");
        return;
      }
      const raw = JSON.stringify(message);
      sentBytes += new TextEncoder().encode(raw).length;
      if (message.type === "input")
        prediction.timing.add({
          stage: "sent",
          playerId,
          inputEpoch: message.inputEpoch,
          tick: message.tick,
          at: performance.now(),
        });
      current.send(raw);
    });
  }
  function disconnect(reason = "Disconnected") {
    generation++;
    outgoing.clear();
    incoming.clear();
    pendingPings.clear();
    socket?.close();
    socket = undefined;
    controls.clear();
    pointer.clear();
    prediction.clear();
    interpolation.clear();
    latest = undefined;
    playerId = "";
    syncing = false;
    timingReady = false;
    calibrating = false;
    calibrationSamples = 0;
    rtts.values = [];
    clock.clear();
    scheduling.clear();
    controlAt = -Infinity;
    setStatus(reason);
    note(reason);
  }
  function connect() {
    disconnect();
    setStatus("Connecting…");
    started = performance.now();
    receivedBytes = 0;
    sentBytes = 0;
    const current = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    socket = current;
    const ownGeneration = generation;
    current.addEventListener("open", () => {
      if (ownGeneration === generation)
        send({
          type: "hello",
          protocol: PROTOCOL_VERSION,
          content: CONTENT_VERSION,
        });
    });
    current.addEventListener("message", (event) => {
      if (ownGeneration !== generation) return;
      if (typeof event.data !== "string") {
        disconnect("Invalid binary server message");
        return;
      }
      receivedBytes += new TextEncoder().encode(event.data).length;
      incoming.enqueue(() => {
        if (ownGeneration !== generation) return;
        try {
          receive(event.data as string);
        } catch (error) {
          disconnect(
            `Protocol error: ${error instanceof Error ? error.message : error}`,
          );
        }
      });
    });
    current.addEventListener("close", () => {
      if (ownGeneration !== generation) return;
      // Preserve a queued explicit rejection before reporting the generic close.
      incoming.enqueue(() => {
        if (ownGeneration === generation)
          disconnect("Connection closed; reconnect");
      });
    });
    current.addEventListener("error", () => {
      if (ownGeneration === generation) note("Socket connection error");
    });
    viewport.focus();
    updateFocus();
  }
  function resync(reason: string) {
    controls.clear();
    prediction.cancelPending();
    if (!prediction.state || socket?.readyState !== WebSocket.OPEN || syncing)
      return;
    syncing = true;
    syncAt = performance.now();
    resyncs++;
    note(reason);
    setStatus("Synchronizing…");
    send({ type: "resync", inputEpoch: prediction.epoch });
  }
  function ping() {
    const now = performance.now();
    lastPing = now;
    pendingPings.set(++nonce, now);
    while (pendingPings.size > 10)
      pendingPings.delete(pendingPings.keys().next().value!);
    send({ type: "ping", nonce });
  }
  function receive(raw: string) {
    const message = parseServer(raw);
    if (message.type === "rejected") {
      disconnect(message.reason);
      return;
    }
    if (message.type === "pong") {
      const sent = pendingPings.get(message.nonce);
      if (sent === undefined) return;
      pendingPings.delete(message.nonce);
      const receivedAt = performance.now();
      clock.observe(message.serverTime, sent, receivedAt);
      prediction.timing.add({
        stage: "clock",
        serverTime: message.serverTime,
        sentAt: sent,
        receivedAt,
        tick: message.tick,
      });
      rtts.add(receivedAt - sent);
      rtt = Math.max(...rtts.values.slice(-3));
      // Keep enough deadline margin when delay grows after calibration. Do not
      // shrink a live timeline: that would pause input while its lead drains.
      if (timingReady && !syncing) lead = Math.max(lead, desiredLead());
      if (calibrating) {
        calibrationSamples++;
        if (calibrationSamples < 3) ping();
        else {
          timingReady = true;
          calibrating = false;
          syncing = false;
          resync("measured timing baseline");
        }
      }
      return;
    }
    for (const receipt of message.inputTiming.receipts)
      prediction.timing.add({
        stage: "receipt",
        playerId: message.playerId,
        ...receipt,
      });
    if (message.type === "baseline") {
      controls.clear();
      latest = message;
      playerId = message.playerId;
      firstTick = message.tick;
      if (!timingReady) {
        prediction.baseline(message, message.tick);
        interpolation.clear();
        interpolation.push(message);
        syncing = true;
        syncAt = performance.now();
        calibrating = true;
        calibrationSamples = 0;
        setStatus("Measuring connection timing…");
        ping();
        return;
      }
      if (!rtts.values.length) rtt = PRESETS[preset].delay * 2;
      lead = desiredLead();
      const estimatedTick = clock.baseline(
        message.tick,
        message.serverTime,
        performance.now(),
      );
      prediction.timing.add({
        stage: "baseline",
        playerId,
        inputEpoch: message.inputEpoch,
        tick: message.tick,
        serverTime: message.serverTime,
        at: performance.now(),
        estimatedTick,
      });
      prediction.baseline(message, Math.floor(serverTick()) + lead);
      interpolation.clear();
      interpolation.push(message);
      syncing = false;
      lastSnapshotAt = performance.now();
      setStatus(
        active ? "Connected · movement active" : "Connected · controls paused",
      );
      note(`baseline: ${message.reason}`);
      if (!active) {
        prediction.cancelPending();
        send({ type: "suspend", inputEpoch: prediction.epoch });
      }
    } else if (message.inputEpoch === prediction.epoch) {
      if (message.rules.jetsEnabled !== prediction.rules.jetsEnabled) {
        resync("room rules mismatch");
        return;
      }
      latest = message;
      lastSnapshotAt = performance.now();
      interpolation.push(message);
      if (!syncing)
        try {
          prediction.reconcile(message);
          if (!active) prediction.cancelPending();
        } catch {
          resync("prediction history mismatch");
        }
    }
  }
  function updateFocus() {
    const next =
      document.hasFocus() &&
      document.visibilityState === "visible" &&
      document.activeElement === viewport;
    if (next === active) return;
    active = next;
    controls.clear();
    if (!active) pointer.clear();
    if (!active && prediction.state) {
      prediction.cancelPending();
      send({ type: "suspend", inputEpoch: prediction.epoch });
      setStatus("Connected · controls paused");
    }
    if (active && prediction.state) resync("focus restored");
  }
  viewport.addEventListener("pointerdown", (event) => {
    viewport.focus();
    updateFocus();
    if (active) pointer.update(event.clientX, event.clientY);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (active) pointer.update(event.clientX, event.clientY);
  });
  viewport.addEventListener("pointerleave", () => pointer.clear());
  for (const event of ["focus", "blur"])
    window.addEventListener(event, updateFocus);
  for (const event of ["focusin", "focusout", "visibilitychange"])
    document.addEventListener(event, updateFocus);
  window.addEventListener("keydown", (event) => {
    if (
      !active ||
      ![
        "KeyA",
        "KeyD",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "ShiftLeft",
        "ShiftRight",
      ].includes(event.code)
    )
      return;
    event.preventDefault();
    controls.press(event.code, event.repeat);
  });
  window.addEventListener("keyup", (event) => {
    controls.release(event.code);
    if (active && ["ArrowLeft", "ArrowRight", "Space"].includes(event.code))
      event.preventDefault();
  });
  element("connect").onclick = connect;
  element("disconnect").onclick = () => disconnect();
  element("reconnect").onclick = connect;
  element("reset").onclick = () => {
    if (prediction.state && !syncing && performance.now() - controlAt >= 1000) {
      beginControlCooldown();
      send({ type: "reset", inputEpoch: prediction.epoch });
    }
    viewport.focus();
  };
  element("jets").onclick = () => {
    if (prediction.state && !syncing && performance.now() - controlAt >= 1000) {
      beginControlCooldown();
      send({
        type: "setJets",
        inputEpoch: prediction.epoch,
        enabled: !prediction.rules.jetsEnabled,
      });
    }
    viewport.focus();
  };
  element<HTMLSelectElement>("latency").onchange = (event) => {
    const restartAdmission = !!socket && !prediction.state;
    preset = (event.target as HTMLSelectElement).value as Preset;
    outgoing.clear();
    incoming.clear();
    outgoing.preset = preset;
    incoming.preset = preset;
    pendingPings.clear();
    rtts.values = [];
    clock.clear();
    scheduling.clear();
    rtt = PRESETS[preset].delay * 2;
    timingReady = false;
    calibrating = false;
    calibrationSamples = 0;
    syncing = false;
    // Clearing delayed work can cancel hello before a player/epoch exists.
    if (restartAdmission) connect();
    else resync("latency preset changed");
    viewport.focus();
  };
  function refreshControlButtons() {
    const controlDisabled =
      !prediction.state || syncing || performance.now() - controlAt < 1000;
    element<HTMLButtonElement>("reset").disabled = controlDisabled;
    element<HTMLButtonElement>("jets").disabled = controlDisabled;
    const label = `${prediction.rules.jetsEnabled ? "Disable" : "Enable"} jets · resets both players`;
    // Replacing the pressed button's text during focusout can cancel WebKit's click.
    if (element("jets").textContent !== label)
      element("jets").textContent = label;
  }
  function beginControlCooldown() {
    controlAt = performance.now();
    refreshControlButtons();
  }
  function diagnostics() {
    const seconds = Math.max(1, (performance.now() - started) / 1000);
    return {
      build: BUILD_ID,
      content: CONTENT_VERSION,
      protocol: PROTOCOL_VERSION,
      movement: MOVEMENT,
      jets: JETS,
      rules: prediction.rules,
      status,
      active,
      playerId,
      preset,
      serverTick: latest?.tick ?? 0,
      predictedTick: prediction.tick,
      finalizedTick: prediction.finalizedTick,
      rtt,
      lead,
      schedulingJitterMs: scheduling.allowance,
      inputEpoch: prediction.epoch,
      pendingInputs: prediction.history.size,
      interpolationDepth: interpolation.snapshots.length,
      underruns: interpolation.underruns,
      staleMs: lastSnapshotAt ? performance.now() - lastSnapshotAt : 0,
      correction: prediction.correction,
      aim: {
        pointerValid: pointer.valid,
        reticleVisible,
        target: currentPointerTarget,
        predictedQ: prediction.state?.aimQ,
        predictedDegrees:
          prediction.state && aimQToDegrees(prediction.state.aimQ),
        authoritativeQ: prediction.authoritative?.aimQ,
        authoritativeDegrees:
          prediction.authoritative &&
          aimQToDegrees(prediction.authoritative.aimQ),
        correctionSteps: prediction.aimCorrection,
        correctionDegrees: Math.abs(aimQToDegrees(prediction.aimCorrection)),
        corrections: prediction.aimCorrections.summary(),
      },
      corrections: prediction.corrections.summary(),
      correctionsByActivity: {
        ordinary: prediction.ordinaryCorrections.summary(),
        thrust: prediction.thrustCorrections.summary(),
      },
      frameMs: frames.summary(),
      resyncs,
      server: latest?.stats,
      inputTiming: latest?.inputTiming,
      upstreamBps: sentBytes / seconds,
      downstreamBps: receivedBytes / seconds,
      queues: {
        incoming: incoming.size,
        outgoing: outgoing.size,
        socket: socket?.bufferedAmount ?? 0,
      },
      predicted: prediction.state,
      authoritative: prediction.authoritative,
      players: latest?.players ?? [],
      renderer: view.counts(),
      resources: {
        listeners: 11 + (socket ? 4 : 0),
        domElements: document.querySelectorAll("*").length,
      },
      firstTick,
      recentEvents: events.slice(-10),
    };
  }
  element("export").onclick = () => {
    const data = {
      version: 1,
      capturedAt: new Date().toISOString(),
      diagnostics: diagnostics(),
      environment: {
        browser: navigator.userAgent,
        platform: navigator.platform,
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        hardwareConcurrency: navigator.hardwareConcurrency,
      },
      samples: {
        frames: frames.values,
        corrections: prediction.corrections.values,
        aimCorrections: prediction.aimCorrections.values,
        rtt: rtts.values,
      },
      events,
      timing: prediction.timing.records,
      trace: prediction.trace(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `derp-diagnostics-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const diagnosticTimer = setInterval(() => {
    const data = diagnostics();
    element("occupancy").textContent = `${data.players.length} / 2 PLAYERS`;
    element("focus-label").textContent =
      prediction.state && data.staleMs > 350
        ? "WAITING FOR SERVER"
        : active
          ? "CONTROLS ACTIVE"
          : prediction.state
            ? "CLICK ARENA TO RESUME"
            : "CLICK CONNECT TO ENTER";
    element("tick").textContent = latest ? `${latest.tick}` : "—";
    element("rtt").textContent = latest ? `${Math.round(rtt)} ms` : "—";
    element("correction").textContent = latest
      ? `${data.corrections.p95.toFixed(4)} u`
      : "—";
    element("diagnostics").textContent = JSON.stringify(data, null, 2);
    element<HTMLButtonElement>("connect").disabled = !!socket;
    element<HTMLButtonElement>("disconnect").disabled = !socket;
    refreshControlButtons();
    if (syncing && performance.now() - syncAt > 2000)
      disconnect("Synchronization timed out; reconnect");
  }, 250);
  let disposed = false;
  function frame(now: number) {
    if (disposed) return;
    const elapsed = now - lastFrame;
    lastFrame = now;
    if (document.visibilityState === "visible") frames.add(elapsed);
    if (elapsed > 250 && active) resync("frame gap over 250 ms");
    if (
      socket?.readyState === WebSocket.OPEN &&
      playerId &&
      timingReady &&
      now - lastPing > 1000
    )
      ping();
    const pointerTarget: WorldPoint | undefined =
      active && !syncing ? pointer.target(view.renderer.domElement) : undefined;
    currentPointerTarget = pointerTarget;
    if (active && !syncing && prediction.state) {
      if (now - lastSnapshotAt > 1000) resync("snapshots stale");
      else {
        const target = Math.floor(serverTick()) + lead;
        if (target - prediction.tick > 16) resync("client timing debt");
        else
          try {
            for (let i = 0; i < 5 && prediction.tick < target; i++) {
              const aim = pointer.sample(prediction.state!, pointerTarget);
              send(prediction.advance(controls.sample(aim.aimQ)));
            }
          } catch {
            resync("history bound");
          }
      }
    }
    element<HTMLProgressElement>("fuel").value =
      prediction.state?.jetFuelTicksRemaining ?? JETS.fuelTicks;
    element("fuel-label").textContent =
      prediction.state && prediction.rules.jetsEnabled
        ? `Jet fuel · ${prediction.state.jetFuelTicksRemaining} / ${JETS.fuelTicks}`
        : "Jets off";
    prediction.smooth(Math.min(elapsed, 100));
    const displayedAim = prediction.state
      ? pointer.sample(prediction.state, pointerTarget)
      : { aimQ: 0, reticleVisible: false };
    reticleVisible = active && !syncing && displayedAim.reticleVisible;
    const players = interpolation.at(
      serverTick() - rtt / 2 / TICK_MS - 100 / TICK_MS,
      playerId,
    );
    if (prediction.state)
      players.push({
        ...prediction.state,
        x: prediction.state.x + prediction.offset.x,
        y: prediction.state.y + prediction.offset.y,
      });
    view.draw(
      players,
      playerId,
      prediction.authoritative,
      element<HTMLInputElement>("debug").checked,
      pointerTarget,
      reticleVisible,
    );
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Test hooks exist only on explicitly requested local test pages; they cannot alter server state.
  if (new URLSearchParams(location.search).has("test"))
    Object.assign(window, {
      __derp: {
        diagnostics,
        timingRecords: () => prediction.timing.records,
        fixture: (trace?: Trace) => replay(trace ?? fixtureTrace()),
        trace: () => prediction.trace(),
        perturb: () => {
          if (prediction.state) prediction.state.x += 1;
        },
        stall: () => {
          const end = performance.now() + 1000;
          while (performance.now() < end) {
            /* deliberate test stall */
          }
        },
      },
    });
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      clearInterval(diagnosticTimer);
      disconnect();
      prediction.dispose();
      view.dispose();
    },
    { once: true },
  );
}
