/* WPT PLC Simulator -- Vanilla JS Control Panel */
/* No imports, no modules. Runs in browser as plain script. */

(function () {
  'use strict';

  // ===== Alarm Definitions =====
  var ALARM_DEFS = [
    { word: 0, bit: 0, name: 'Emergency Stop' },
    { word: 0, bit: 1, name: 'Vac Pump Trip' },
    { word: 0, bit: 2, name: 'Vac Pump OL' },
    { word: 0, bit: 3, name: 'Main Motor OL' },
    { word: 0, bit: 8, name: 'Motor PTO' },
    { word: 0, bit: 9, name: 'Chiller Alarm' },
    { word: 0, bit: 10, name: 'Lid Open Err' },
    { word: 0, bit: 11, name: 'Lid Close Err' },
    { word: 1, bit: 0, name: 'Lid Overcurr' },
    { word: 1, bit: 3, name: 'Phase Error' },
    { word: 1, bit: 9, name: 'Vac Pump OT' },
    { word: 1, bit: 13, name: 'QG Emerg Stop' },
    { word: 2, bit: 0, name: 'Water Safety' },
    { word: 2, bit: 3, name: 'Cool Pump Trip' },
    { word: 2, bit: 5, name: 'Temp High' },
    { word: 2, bit: 8, name: 'Press High' },
    { word: 3, bit: 0, name: 'Motor OT' },
    { word: 3, bit: 4, name: 'Inverter Fault' },
    { word: 3, bit: 8, name: 'Sensor Fail' },
    { word: 4, bit: 0, name: 'Comm Timeout' },
  ];

  // Key machine variables displayed in the values table
  var VALUE_FIELDS = [
    { key: 'garbageTemp', label: 'Garbage Temp' },
    { key: 'chamberPressure', label: 'Chamber Pressure' },
    { key: 'mainMotorSpeed', label: 'Motor Speed' },
    { key: 'mainMotorTorque', label: 'Motor Torque' },
    { key: 'mainMotorCurrent', label: 'Motor Current' },
    { key: 'vacuumPumpSpeed01', label: 'Vac Pump 1' },
    { key: 'vacuumPumpSpeed02', label: 'Vac Pump 2' },
    { key: 'thermoLeftLower', label: 'Thermo L/Low' },
    { key: 'thermoLeftMedium', label: 'Thermo L/Med' },
    { key: 'thermoLeftUpper', label: 'Thermo L/Up' },
    { key: 'thermoRightLower', label: 'Thermo R/Low' },
    { key: 'thermoRightMedium', label: 'Thermo R/Med' },
    { key: 'thermoRightUpper', label: 'Thermo R/Up' },
    { key: 'materialInputWeight', label: 'Input Weight' },
    { key: 'materialOutputWeight', label: 'Output Weight' },
    { key: 'completedCycles', label: 'Completed Cycles' },
    { key: 'selectedCycle', label: 'Selected Cycle' },
    { key: 'machineStatus', label: 'Machine Status' },
    { key: 'currentPhase', label: 'Machine Phase' },
    { key: 'energyConsumption', label: 'Energy (kWh)' },
    { key: 'waterConsumption', label: 'Water (L)' },
  ];

  // FSM state mappings
  var FSM_LABELS = { 2: 'IDLE', 255: 'READING', 254: 'WRITING', 100: 'ACK' };
  var FSM_CLASSES = { 2: 'fsm-idle', 255: 'fsm-reading', 254: 'fsm-writing', 100: 'fsm-idle' };

  // ===== DOM References =====
  var errorBanner = document.getElementById('errorBanner');
  var scenarioSelect = document.getElementById('scenarioSelect');
  var applyScenarioBtn = document.getElementById('applyScenario');

  // Dropdowns
  var cycleType = document.getElementById('cycleType');
  var machineStatus = document.getElementById('machineStatus');
  var machinePhase = document.getElementById('machinePhase');

  // Sliders
  var sliders = [
    { range: document.getElementById('garbageTemp'), num: document.getElementById('garbageTempVal'), field: 'garbageTemp' },
    { range: document.getElementById('chamberPressure'), num: document.getElementById('chamberPressureVal'), field: 'chamberPressure' },
    { range: document.getElementById('mainMotorSpeed'), num: document.getElementById('mainMotorSpeedVal'), field: 'mainMotorSpeed' },
    { range: document.getElementById('vacuumPumpSpeed01'), num: document.getElementById('vacuumPumpSpeed01Val'), field: 'vacuumPumpSpeed01' },
  ];

  // Fault injection
  var faultDropAck = document.getElementById('faultDropAck');
  var faultWrongState = document.getElementById('faultWrongState');
  var faultDropAckWarning = document.getElementById('faultDropAckWarning');
  var faultWrongStateWarning = document.getElementById('faultWrongStateWarning');
  var ackDelaySlider = document.getElementById('ackDelay');
  var ackDelayValue = document.getElementById('ackDelayValue');

  // Status dashboard
  var lastPacketEl = document.getElementById('lastPacket');
  var packetCountEl = document.getElementById('packetCount');
  var handshakeStateEl = document.getElementById('handshakeState');
  var valuesTableBody = document.getElementById('valuesTableBody');
  var activeAlarmsList = document.getElementById('activeAlarmsList');

  var apiError = false;

  // ===== API Helpers =====
  function fetchApi(url, options) {
    return fetch(url, options)
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.error || 'Request failed');
          });
        }
        if (apiError) {
          apiError = false;
          errorBanner.style.display = 'none';
        }
        return res.json();
      })
      .catch(function (err) {
        apiError = true;
        errorBanner.style.display = 'block';
        throw err;
      });
  }

  function putState(partial) {
    return fetchApi('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
  }

  function postFault(data) {
    return fetchApi('/api/fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  // ===== Update Controls from State =====
  function updateControls(state) {
    // Dropdowns
    cycleType.value = String(state.machine.selectedCycle);
    machineStatus.value = String(state.machine.machineStatus);
    machinePhase.value = String(state.machine.currentPhase);

    // Sliders
    for (var i = 0; i < sliders.length; i++) {
      var s = sliders[i];
      var val = state.machine[s.field];
      if (val !== undefined) {
        s.range.value = val;
        s.num.value = val;
      }
    }

    // Alarm toggles
    var buttons = document.querySelectorAll('.alarm-toggle');
    for (var j = 0; j < buttons.length; j++) {
      var btn = buttons[j];
      var word = parseInt(btn.getAttribute('data-word'), 10);
      var bit = parseInt(btn.getAttribute('data-bit'), 10);
      var wordVal = state.alarms.words[word] || 0;
      var isActive = (wordVal & (1 << bit)) !== 0;
      if (isActive) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }

    // Fault injection
    faultDropAck.checked = state.handshake.faultDropAck;
    faultWrongState.checked = state.handshake.faultWrongState;
    faultDropAckWarning.style.display = state.handshake.faultDropAck ? 'block' : 'none';
    faultWrongStateWarning.style.display = state.handshake.faultWrongState ? 'block' : 'none';

    // ACK delay
    ackDelaySlider.value = state.handshake.ackDelayMs;
    ackDelayValue.textContent = state.handshake.ackDelayMs;

    // Also update dashboard
    updateDashboard(state);
  }

  // ===== Update Dashboard (read-only live status) =====
  function updateDashboard(state) {
    // Last packet timestamp
    var lastData = state.broadcast.lastDataSentAt;
    var lastAlarm = state.broadcast.lastAlarmSentAt;
    var latest = lastData || lastAlarm;
    if (latest) {
      var d = new Date(latest);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      var ss = String(d.getSeconds()).padStart(2, '0');
      var ms = String(d.getMilliseconds()).padStart(3, '0');
      lastPacketEl.textContent = hh + ':' + mm + ':' + ss + '.' + ms;
    } else {
      lastPacketEl.textContent = '--:--:--';
    }

    // Packet count
    packetCountEl.textContent = state.broadcast.dataPacketCount + ' data / ' + state.broadcast.alarmPacketCount + ' alarms';

    // Handshake FSM state (use port9090State as primary indicator)
    var fsmState = state.handshake.port9090State;
    var fsmLabel = FSM_LABELS[fsmState] || 'UNKNOWN';
    var fsmClass = FSM_CLASSES[fsmState] || 'fsm-timeout';
    handshakeStateEl.textContent = fsmLabel;
    handshakeStateEl.className = 'fsm-badge ' + fsmClass;

    // Current values table
    var html = '';
    for (var i = 0; i < VALUE_FIELDS.length; i++) {
      var f = VALUE_FIELDS[i];
      var val = state.machine[f.key];
      if (val === undefined) val = '--';
      if (typeof val === 'number') val = val.toFixed ? (Number.isInteger(val) ? val : val.toFixed(2)) : val;
      html += '<tr><td>' + f.label + '</td><td>' + val + '</td></tr>';
    }
    valuesTableBody.innerHTML = html;

    // Active alarms list
    var activeAlarms = [];
    for (var w = 0; w < (state.alarms.words.length); w++) {
      var wordVal = state.alarms.words[w];
      if (!wordVal) continue;
      for (var b = 0; b < 16; b++) {
        if (wordVal & (1 << b)) {
          // Find alarm name from ALARM_DEFS
          var alarmName = 'W' + w + ':B' + b;
          for (var a = 0; a < ALARM_DEFS.length; a++) {
            if (ALARM_DEFS[a].word === w && ALARM_DEFS[a].bit === b) {
              alarmName = ALARM_DEFS[a].name;
              break;
            }
          }
          activeAlarms.push(alarmName);
        }
      }
    }

    if (activeAlarms.length === 0) {
      activeAlarmsList.innerHTML = '<p class="muted-text">No alarms active</p>';
    } else {
      var alarmsHtml = '';
      for (var k = 0; k < activeAlarms.length; k++) {
        alarmsHtml += '<div class="alarm-list-item"><span class="dot"></span>' + activeAlarms[k] + '</div>';
      }
      activeAlarmsList.innerHTML = alarmsHtml;
    }
  }

  // ===== Poll State =====
  function pollState() {
    fetchApi('/api/state')
      .then(function (state) {
        updateDashboard(state);
      })
      .catch(function () {
        // Error already handled by fetchApi
      });
  }

  // ===== Event Handlers =====

  // Scenario apply
  applyScenarioBtn.addEventListener('click', function () {
    var name = scenarioSelect.value;
    fetchApi('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    }).then(function (state) {
      updateControls(state);
      // Flash gold border
      applyScenarioBtn.classList.add('flash');
      setTimeout(function () {
        applyScenarioBtn.classList.remove('flash');
      }, 500);
    }).catch(function () {
      // handled by fetchApi
    });
  });

  // Dropdown changes -> immediate state update
  cycleType.addEventListener('change', function () {
    putState({ machine: { selectedCycle: parseInt(cycleType.value, 10) } });
  });

  machineStatus.addEventListener('change', function () {
    putState({ machine: { machineStatus: parseInt(machineStatus.value, 10) } });
  });

  machinePhase.addEventListener('change', function () {
    putState({ machine: { currentPhase: parseInt(machinePhase.value, 10) } });
  });

  // Slider bidirectional sync + state update
  function setupSlider(slider) {
    slider.range.addEventListener('input', function () {
      slider.num.value = slider.range.value;
      var update = {};
      update[slider.field] = parseInt(slider.range.value, 10);
      putState({ machine: update });
    });

    slider.num.addEventListener('change', function () {
      var val = parseInt(slider.num.value, 10);
      var min = parseInt(slider.range.min, 10);
      var max = parseInt(slider.range.max, 10);
      if (isNaN(val)) val = min;
      if (val < min) val = min;
      if (val > max) val = max;
      slider.num.value = val;
      slider.range.value = val;
      var update = {};
      update[slider.field] = val;
      putState({ machine: update });
    });
  }

  for (var i = 0; i < sliders.length; i++) {
    setupSlider(sliders[i]);
  }

  // Alarm toggle buttons -> XOR the bit
  var alarmButtons = document.querySelectorAll('.alarm-toggle');
  for (var j = 0; j < alarmButtons.length; j++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var word = parseInt(btn.getAttribute('data-word'), 10);
        var bit = parseInt(btn.getAttribute('data-bit'), 10);

        // Get current state to compute XOR
        fetchApi('/api/state').then(function (state) {
          var currentWordVal = state.alarms.words[word] || 0;
          var newWordVal = currentWordVal ^ (1 << bit);
          var words = state.alarms.words.slice();
          words[word] = newWordVal;
          putState({ alarms: { words: words } }).then(function (updated) {
            // Update toggle appearance
            var isActive = (newWordVal & (1 << bit)) !== 0;
            if (isActive) {
              btn.classList.add('active');
            } else {
              btn.classList.remove('active');
            }
          });
        });
      });
    })(alarmButtons[j]);
  }

  // Fault injection checkboxes
  faultDropAck.addEventListener('change', function () {
    postFault({ faultDropAck: faultDropAck.checked });
    faultDropAckWarning.style.display = faultDropAck.checked ? 'block' : 'none';
  });

  faultWrongState.addEventListener('change', function () {
    postFault({ faultWrongState: faultWrongState.checked });
    faultWrongStateWarning.style.display = faultWrongState.checked ? 'block' : 'none';
  });

  // ACK delay slider
  ackDelaySlider.addEventListener('input', function () {
    ackDelayValue.textContent = ackDelaySlider.value;
    postFault({ ackDelayMs: parseInt(ackDelaySlider.value, 10) });
  });

  // ===== Initialization =====
  fetchApi('/api/state')
    .then(function (state) {
      updateControls(state);
    })
    .catch(function () {
      // handled by fetchApi
    });

  // Start polling every 1 second
  setInterval(pollState, 1000);
})();
