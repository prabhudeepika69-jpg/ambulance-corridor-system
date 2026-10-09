import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { io } from "socket.io-client";
import "leaflet/dist/leaflet.css";

const socket = io("http://localhost:5000");

const hospital = {
  name: "City Emergency Hospital",
  latitude: 12.9784,
  longitude: 77.5917,
};

const VOICE_MESSAGE =
  "Ambulance is near. Please clear the way.";

function calculateDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R = 6371;

  const dLat =
    ((lat2 - lat1) * Math.PI) / 180;

  const dLon =
    ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

/* =========================================================
   MAP ICONS
========================================================= */

function ambulanceIcon() {
  return L.divIcon({
    className: "custom-marker",
    html: `
      <div class="ambulance-marker">
        🚑
      </div>
    `,
    iconSize: [45, 45],
    iconAnchor: [22, 22],
  });
}

function vehicleIcon(type, alert) {
  let emoji = "🚗";

  if (type === "BUS") {
    emoji = "🚌";
  } else if (type === "AUTO") {
    emoji = "🛺";
  } else if (type === "TRUCK") {
    emoji = "🚚";
  }

  return L.divIcon({
    className: "custom-marker",
    html: `
      <div class="vehicle-marker ${
        alert
          ? "vehicle-alert-marker"
          : ""
      }">
        ${emoji}
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function hospitalIcon() {
  return L.divIcon({
    className: "custom-marker",
    html: `
      <div class="hospital-marker">
        🏥
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/* =========================================================
   MAP FOLLOWER
========================================================= */

function MapFollower({ ambulance }) {
  const map = useMap();

  useEffect(() => {
    if (!ambulance) return;

    map.setView(
      [
        ambulance.latitude,
        ambulance.longitude,
      ],
      map.getZoom(),
      {
        animate: true,
      }
    );
  }, [
    ambulance?.latitude,
    ambulance?.longitude,
    map,
  ]);

  return null;
}

/* =========================================================
   APP
========================================================= */

function App() {
  const [data, setData] = useState(null);

  const [view, setView] =
    useState("dashboard");

  /*
   * Voice is automatically enabled when
   * START EMERGENCY is pressed.
   */
  const [voiceEnabled, setVoiceEnabled] =
    useState(false);

  const [voiceStatus, setVoiceStatus] =
    useState("Voice disabled");

  /*
   * Tracks vehicles that were inside
   * the 500m circle during the previous
   * backend update.
   */
  const previousInsideVehicles =
    useRef(new Set());

  /*
   * Prevents the same vehicle from
   * repeatedly triggering voice while
   * it remains inside the circle.
   */
  const voiceAlertedVehicles =
    useRef(new Set());

  /*
   * Used when emergency starts so that
   * vehicles already inside 500m do not
   * immediately produce a false "entered"
   * event.
   */
  const firstEmergencyUpdate =
    useRef(true);

  /*
   * Automatic popup state.
   */
  const [
    corridorPopup,
    setCorridorPopup,
  ] = useState(null);

  const popupTimer =
    useRef(null);

  /* =========================================================
     RECEIVE BACKEND DATA
  ========================================================= */

  useEffect(() => {
    const handleSystemData = (
      newData
    ) => {
      setData(newData);
    };

    socket.on(
      "systemData",
      handleSystemData
    );

    fetch(
      "http://localhost:5000/api/status"
    )
      .then((response) =>
        response.json()
      )
      .then((result) => {
        setData(result);
      })
      .catch((error) => {
        console.error(
          "Backend connection error:",
          error
        );
      });

    return () => {
      socket.off(
        "systemData",
        handleSystemData
      );

      if (popupTimer.current) {
        clearTimeout(
          popupTimer.current
        );
      }
    };
  }, []);

  /* =========================================================
     AUTOMATIC 500m CORRIDOR DETECTION
  ========================================================= */

  useEffect(() => {
    if (!data) return;

    const ambulance =
      data.ambulance;

    const vehicles =
      data.vehicles || [];

    /*
     * Emergency ended.
     * Reset everything.
     */
    if (!ambulance?.emergency) {
      previousInsideVehicles.current =
        new Set();

      voiceAlertedVehicles.current.clear();

      firstEmergencyUpdate.current =
        true;

      setCorridorPopup(null);

      return;
    }

    /*
     * Get vehicles currently inside
     * the actual 500m CIRCLE.
     *
     * IMPORTANT:
     * This does NOT use vehicle.alert.
     */
    const currentInsideVehicles =
      new Set(
        vehicles
          .filter(
            (vehicle) =>
              Number(
                vehicle.distance || 0
              ) <= 500
          )
          .map(
            (vehicle) =>
              vehicle.id
          )
      );

    /*
     * First update after emergency starts.
     *
     * We remember the vehicles already
     * inside the circle without speaking.
     */
    if (
      firstEmergencyUpdate.current
    ) {
      previousInsideVehicles.current =
        currentInsideVehicles;

      firstEmergencyUpdate.current =
        false;

      return;
    }

    /*
     * Check every vehicle.
     */
    vehicles.forEach(
      (vehicle) => {
        const vehicleId =
          vehicle.id;

        const distance =
          Number(
            vehicle.distance || 0
          );

        const isInside =
          distance <= 500;

        const wasInside =
          previousInsideVehicles.current.has(
            vehicleId
          );

        const alreadyAlerted =
          voiceAlertedVehicles.current.has(
            vehicleId
          );

        /*
         * THE IMPORTANT CONDITION:
         *
         * Outside before
         * +
         * Inside now
         * =
         * Vehicle just entered
         * emergency corridor.
         */
        if (
          isInside &&
          !wasInside &&
          !alreadyAlerted
        ) {
          console.log(
            "🚨 VEHICLE ENTERED 500m CORRIDOR:",
            vehicleId,
            distance
          );

          /*
           * Remember this vehicle so it
           * doesn't speak continuously.
           */
          voiceAlertedVehicles.current.add(
            vehicleId
          );

          /*
           * Show automatic popup.
           */
          setCorridorPopup({
            vehicleId:
              vehicleId,
            distance:
              distance,
            type:
              vehicle.type,
          });

          /*
           * Automatically hide popup
           * after 5 seconds.
           */
          if (popupTimer.current) {
            clearTimeout(
              popupTimer.current
            );
          }

          popupTimer.current =
            setTimeout(() => {
              setCorridorPopup(
                null
              );
            }, 5000);

          /*
           * AUTOMATIC VOICE
           */
          if (voiceEnabled) {
            speakVoiceAlert(
              vehicleId
            );
          }
        }

        /*
         * If vehicle has left the circle,
         * remove it from the alerted set.
         *
         * If it enters again later,
         * it can trigger voice again.
         */
        if (!isInside) {
          voiceAlertedVehicles.current.delete(
            vehicleId
          );
        }
      }
    );

    /*
     * Save current circle status
     * for the next backend update.
     */
    previousInsideVehicles.current =
      currentInsideVehicles;
  }, [data, voiceEnabled]);

  /* =========================================================
     SPEAK VOICE ALERT
  ========================================================= */

  function speakVoiceAlert(
    vehicleId = ""
  ) {
    if (
      !(
        "speechSynthesis" in
        window
      )
    ) {
      setVoiceStatus(
        "Speech not supported by browser"
      );

      return;
    }

    try {
      /*
       * Stop previous speech.
       */
      window.speechSynthesis.cancel();

      /*
       * Get available voices.
       */
      const voices =
        window.speechSynthesis.getVoices();

      const speech =
        new SpeechSynthesisUtterance(
          VOICE_MESSAGE
        );

      /*
       * Prefer an English voice.
       */
      const englishVoice =
        voices.find(
          (voice) =>
            voice.lang &&
            voice.lang
              .toLowerCase()
              .startsWith("en")
        );

      if (englishVoice) {
        speech.voice =
          englishVoice;
      }

      speech.lang = "en-US";
      speech.rate = 0.9;
      speech.pitch = 1;
      speech.volume = 1;

      speech.onstart = () => {
        setVoiceStatus(
          "🔊 Speaking automatic alert..."
        );

        console.log(
          "🔊 AUTOMATIC VOICE STARTED:",
          vehicleId
        );
      };

      speech.onend = () => {
        setVoiceStatus(
          "🔊 Automatic voice ready"
        );
      };

      speech.onerror = (
        event
      ) => {
        console.error(
          "Automatic speech error:",
          event
        );

        setVoiceStatus(
          "⚠️ Voice error"
        );
      };

      /*
       * Actual automatic speech.
       */
      window.speechSynthesis.speak(
        speech
      );

      console.log(
        "🔊 VOICE ALERT:",
        VOICE_MESSAGE,
        "Vehicle:",
        vehicleId
      );
    } catch (error) {
      console.error(
        "Voice error:",
        error
      );

      setVoiceStatus(
        "Voice unavailable"
      );
    }
  }

  /* =========================================================
     MANUAL VOICE ENABLE
     
     Kept as a backup, but NOT required
     for the emergency workflow.
  ========================================================= */

  function enableVoice() {
    if (
      !(
        "speechSynthesis" in
        window
      )
    ) {
      setVoiceStatus(
        "Your browser does not support voice"
      );

      return;
    }

    setVoiceEnabled(true);

    window.speechSynthesis.cancel();

    const speech =
      new SpeechSynthesisUtterance(
        "Voice alerts enabled."
      );

    speech.rate = 0.9;
    speech.volume = 1;
    speech.lang = "en-US";

    speech.onstart = () => {
      setVoiceStatus(
        "🔊 Voice enabled"
      );
    };

    speech.onend = () => {
      setVoiceStatus(
        "🔊 Voice ready"
      );
    };

    speech.onerror = () => {
      setVoiceStatus(
        "⚠️ Voice blocked by browser"
      );
    };

    window.speechSynthesis.speak(
      speech
    );
  }

  /* =========================================================
     TEST VOICE
     
     ONLY BACKUP.
     
     Automatic emergency voice does NOT
     depend on this function.
  ========================================================= */

  function testVoice() {
    setVoiceEnabled(true);

    speakVoiceAlert("TEST");
  }

  /* =========================================================
     DISABLE VOICE
  ========================================================= */

  function disableVoice() {
    setVoiceEnabled(false);

    if (
      "speechSynthesis" in
      window
    ) {
      window.speechSynthesis.cancel();
    }

    setVoiceStatus(
      "Voice disabled"
    );
  }

  /* =========================================================
     START EMERGENCY
  ========================================================= */

  function startEmergency() {
    /*
     * Completely reset the previous
     * emergency.
     */
    previousInsideVehicles.current =
      new Set();

    voiceAlertedVehicles.current.clear();

    firstEmergencyUpdate.current =
      true;

    /*
     * IMPORTANT:
     *
     * START EMERGENCY itself is a real
     * user click.
     *
     * We enable speech here.
     */
    if (
      "speechSynthesis" in
      window
    ) {
      try {
        window.speechSynthesis.cancel();

        /*
         * Load voices.
         */
        window.speechSynthesis.getVoices();

        /*
         * Mark voice as active.
         */
        setVoiceEnabled(true);

        setVoiceStatus(
          "🔊 Automatic voice alerts active"
        );

        console.log(
          "🔊 Automatic voice system activated"
        );
      } catch (error) {
        console.error(
          "Voice initialization error:",
          error
        );
      }
    }

    /*
     * Start backend emergency.
     */
    socket.emit(
      "startEmergency"
    );
  }

  /* =========================================================
     STOP EMERGENCY
  ========================================================= */

  function stopEmergency() {
    socket.emit(
      "stopEmergency"
    );

    previousInsideVehicles.current =
      new Set();

    voiceAlertedVehicles.current.clear();

    firstEmergencyUpdate.current =
      true;

    setCorridorPopup(null);

    if (
      popupTimer.current
    ) {
      clearTimeout(
        popupTimer.current
      );
    }

    if (
      "speechSynthesis" in
      window
    ) {
      window.speechSynthesis.cancel();
    }

    setVoiceStatus(
      voiceEnabled
        ? "🔊 Voice ready"
        : "Voice disabled"
    );
  }

  /* =========================================================
     AMBULANCE MOVEMENT
  ========================================================= */

  function move(direction) {
    socket.emit(
      `move${direction}`
    );
  }

  /* =========================================================
     LOADING
  ========================================================= */

  if (!data) {
    return (
      <div className="loading-screen">

        <div>

          <h1>
            🚑 Dynamic Emergency
            Corridor
          </h1>

          <p>
            Connecting to emergency
            traffic system...
          </p>

        </div>

      </div>
    );
  }

  /* =========================================================
     DATA
  ========================================================= */

  const ambulance =
    data.ambulance;

  const vehicles =
    data.vehicles || [];

  const alertedVehicles =
    vehicles.filter(
      (vehicle) =>
        vehicle.alert
    );

  const vehiclesInsideCorridor =
    vehicles.filter(
      (vehicle) =>
        Number(
          vehicle.distance || 0
        ) <= 500
    );

  const hospitalDistance =
    calculateDistance(
      ambulance.latitude,
      ambulance.longitude,
      hospital.latitude,
      hospital.longitude
    );

  const etaMinutes =
    ambulance.speed > 0
      ? (hospitalDistance /
          ambulance.speed) *
        60
      : 0;

  const sessionId =
    ambulance.sessionId ||
    "NO ACTIVE SESSION";

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div className="app">

      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside className="sidebar">

        <div className="brand">

          <div className="brand-icon">
            🚑
          </div>

          <div>

            <h1>
              Dynamic Emergency
            </h1>

            <span>
              Corridor System
            </span>

          </div>

        </div>

        {/* AMBULANCE STATUS */}

        <div className="ambulance-status-card">

          <div className="status-card-header">

            <span>
              AMBULANCE
            </span>

            <span
              className={
                ambulance.emergency
                  ? "status-online"
                  : "status-offline"
              }
            >
              ●{" "}
              {ambulance.emergency
                ? "EMERGENCY"
                : "STANDBY"}
            </span>

          </div>

          <div className="ambulance-id">
            {ambulance.id}
          </div>

          <div className="ambulance-details">

            <div>

              <span>
                Speed
              </span>

              <strong>
                {ambulance.speed} km/h
              </strong>

            </div>

            <div>

              <span>
                Direction
              </span>

              <strong>
                {
                  ambulance.directionName
                }
              </strong>

            </div>

          </div>

          <div
            style={{
              marginTop: "12px",
              fontSize: "11px",
              opacity: 0.7,
            }}
          >
            Session
          </div>

          <div
            style={{
              fontSize: "11px",
              fontWeight: "700",
              wordBreak: "break-all",
            }}
          >
            {sessionId}
          </div>

        </div>

        {/* EMERGENCY BUTTON */}

        {!ambulance.emergency ? (

          <button
            className="start-button"
            onClick={
              startEmergency
            }
          >
            🚨 START EMERGENCY
          </button>

        ) : (

          <button
            className="stop-button"
            onClick={
              stopEmergency
            }
          >
            🛑 END EMERGENCY
          </button>

        )}

        {/* VOICE */}

        <div
          className="movement-control"
          style={{
            marginTop: "12px",
          }}
        >

          <h3>
            🔊 VOICE ALERT
          </h3>

          <div
            style={{
              fontSize: "12px",
              marginBottom: "8px",
              opacity: 0.8,
            }}
          >
            {voiceStatus}
          </div>

          {!voiceEnabled ? (

            <button
              onClick={
                enableVoice
              }
              style={{
                width: "100%",
                padding: "10px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "700",
              }}
            >
              🔊 ENABLE VOICE
            </button>

          ) : (

            <>

              <button
                onClick={
                  testVoice
                }
                style={{
                  width: "100%",
                  padding: "9px",
                  marginBottom: "7px",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                }}
              >
                🔊 TEST VOICE
              </button>

              <button
                onClick={
                  disableVoice
                }
                style={{
                  width: "100%",
                  padding: "8px",
                  border:
                    "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  background:
                    "transparent",
                  color: "inherit",
                }}
              >
                Disable Voice
              </button>

            </>

          )}

        </div>

        {/* MOVEMENT */}

        <div className="movement-control">

          <h3>
            AMBULANCE MOVEMENT
          </h3>

          <div className="movement-grid">

            <button
              onClick={() =>
                move("North")
              }
            >
              ↑
              <span>
                North
              </span>
            </button>

            <button
              onClick={() =>
                move("South")
              }
            >
              ↓
              <span>
                South
              </span>
            </button>

            <button
              onClick={() =>
                move("West")
              }
            >
              ←
              <span>
                West
              </span>
            </button>

            <button
              onClick={() =>
                move("East")
              }
            >
              →
              <span>
                East
              </span>
            </button>

          </div>

        </div>

        {/* NAVIGATION */}

        <div className="sidebar-menu">

          <button
            className={
              view === "dashboard"
                ? "menu-active"
                : ""
            }
            onClick={() =>
              setView(
                "dashboard"
              )
            }
          >
            📊 Command Center
          </button>

          <button
            className={
              view === "driver"
                ? "menu-active"
                : ""
            }
            onClick={() =>
              setView("driver")
            }
          >
            🚑 Driver View
          </button>

        </div>

        <div className="sidebar-footer">

          <small>
            Dynamic Emergency
            Corridor
          </small>

          <small>
            Smart Transportation
            Prototype
          </small>

        </div>

      </aside>

      {/* =====================================================
          MAIN
      ===================================================== */}

      <main className="main">

        {/* TOPBAR */}

        <header className="topbar">

          <div>

            <h2>
              {view ===
              "dashboard"
                ? "Emergency Command Center"
                : "Ambulance Driver View"}
            </h2>

            <p>
              Clear the Way Before
              the Ambulance Arrives.
            </p>

          </div>

          <div className="topbar-status">

            <span
              className={
                ambulance.emergency
                  ? "mode-badge emergency"
                  : "mode-badge"
              }
            >
              {ambulance.emergency
                ? "🔴 EMERGENCY ACTIVE"
                : "🟢 SYSTEM READY"}
            </span>

            <span className="connection-status">
              ● LIVE
            </span>

          </div>

        </header>

        {/* ===================================================
            COMMAND CENTER
        =================================================== */}

        {view ===
          "dashboard" && (
          <>

            {/* MAP */}

            <section className="map-wrapper">

              <MapContainer
                center={[
                  ambulance.latitude,
                  ambulance.longitude,
                ]}
                zoom={15}
                className="map"
              >

                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapFollower
                  ambulance={
                    ambulance
                  }
                />

                {/* HOSPITAL */}

                <Marker
                  position={[
                    hospital.latitude,
                    hospital.longitude,
                  ]}
                  icon={
                    hospitalIcon()
                  }
                >

                  <Popup>

                    <div className="popup-content">

                      <h3>
                        🏥{" "}
                        {
                          hospital.name
                        }
                      </h3>

                      <p>
                        Emergency
                        destination
                      </p>

                      <p>
                        Distance:{" "}
                        {hospitalDistance.toFixed(
                          2
                        )} km
                      </p>

                      <p>
                        ETA:{" "}
                        {etaMinutes.toFixed(
                          1
                        )} minutes
                      </p>

                    </div>

                  </Popup>

                </Marker>

                {/* AMBULANCE */}

                <Marker
                  position={[
                    ambulance.latitude,
                    ambulance.longitude,
                  ]}
                  icon={
                    ambulanceIcon()
                  }
                >

                  <Popup>

                    <div className="popup-content">

                      <h3>
                        🚑 Ambulance
                      </h3>

                      <p>
                        ID:{" "}
                        {
                          ambulance.id
                        }
                      </p>

                      <p>
                        Speed:{" "}
                        {
                          ambulance.speed
                        } km/h
                      </p>

                      <p>
                        Direction:{" "}
                        {
                          ambulance.directionName
                        }
                      </p>

                      <p>
                        Latitude:{" "}
                        {ambulance.latitude.toFixed(
                          5
                        )}
                      </p>

                      <p>
                        Longitude:{" "}
                        {ambulance.longitude.toFixed(
                          5
                        )}
                      </p>

                      <p>
                        Emergency:{" "}
                        {ambulance.emergency
                          ? "ACTIVE"
                          : "OFF"}
                      </p>

                    </div>

                  </Popup>

                </Marker>

                {/* 500m CIRCLE */}

                <Circle
                  center={[
                    ambulance.latitude,
                    ambulance.longitude,
                  ]}
                  radius={500}
                  pathOptions={{
                    color:
                      ambulance.emergency
                        ? "#ff1744"
                        : "#777",
                    fillColor:
                      ambulance.emergency
                        ? "#ff1744"
                        : "#777",
                    fillOpacity:
                      ambulance.emergency
                        ? 0.14
                        : 0.05,
                    weight: 3,
                  }}
                />

                {/* VEHICLES */}

                {vehicles.map(
                  (vehicle) => (
                    <Marker
                      key={
                        vehicle.id
                      }
                      position={[
                        vehicle.latitude,
                        vehicle.longitude,
                      ]}
                      icon={vehicleIcon(
                        vehicle.type,
                        vehicle.alert
                      )}
                    >

                      <Popup>

                        <div className="vehicle-popup">

                          <h3>
                            {
                              vehicle.id
                            }
                          </h3>

                          <p>
                            Type:{" "}
                            {
                              vehicle.type
                            }
                          </p>

                          <p>
                            Speed:{" "}
                            {
                              vehicle.speed
                            } km/h
                          </p>

                          <p>
                            Distance:{" "}
                            {Number(
                              vehicle.distance ||
                                0
                            ).toFixed(
                              0
                            )} m
                          </p>

                          <p>
                            Position:{" "}
                            {
                              vehicle.position
                            }
                          </p>

                          <p>
                            Forward:{" "}
                            {Number(
                              vehicle.forwardDistance ||
                                0
                            ).toFixed(
                              0
                            )} m
                          </p>

                          <p>
                            Lateral:{" "}
                            {Number(
                              vehicle.lateralDistance ||
                                0
                            ).toFixed(
                              0
                            )} m
                          </p>

                          {vehicle.alert && (
                            <div className="popup-driver-alert">

                              ⚠️ CLEAR THE WAY

                              <br />

                              <small>
                                🔊 Voice alert
                                sent
                              </small>

                            </div>
                          )}

                        </div>

                      </Popup>

                    </Marker>
                  )
                )}

              </MapContainer>

              {/* =================================================
                  AUTOMATIC CORRIDOR ENTRY POPUP
              ================================================= */}

              {corridorPopup && (
                <div
                  style={{
                    position:
                      "absolute",
                    top: "22px",
                    right: "22px",
                    zIndex: 2000,
                    width: "330px",
                    padding: "18px",
                    borderRadius:
                      "14px",
                    background:
                      "rgba(15, 15, 20, 0.96)",
                    border:
                      "2px solid #ff1744",
                    boxShadow:
                      "0 0 30px rgba(255, 23, 68, 0.45)",
                    color: "white",
                    animation:
                      "corridorAlertIn 0.3s ease-out",
                  }}
                >

                  <div
                    style={{
                      fontSize:
                        "13px",
                      fontWeight:
                        "800",
                      color:
                        "#ff1744",
                      marginBottom:
                        "8px",
                    }}
                  >
                    🚨 EMERGENCY
                    CORRIDOR ALERT
                  </div>

                  <div
                    style={{
                      fontSize:
                        "22px",
                      fontWeight:
                        "900",
                      marginBottom:
                        "8px",
                    }}
                  >
                    VEHICLE ENTERED
                  </div>

                  <div
                    style={{
                      fontSize:
                        "16px",
                      fontWeight:
                        "800",
                      marginBottom:
                        "5px",
                    }}
                  >
                    🚗{" "}
                    {
                      corridorPopup.vehicleId
                    }
                  </div>

                  <div
                    style={{
                      fontSize:
                        "13px",
                      opacity: 0.8,
                      marginBottom:
                        "12px",
                    }}
                  >
                    Distance:{" "}
                    {Number(
                      corridorPopup.distance
                    ).toFixed(
                      0
                    )}{" "}
                    m from
                    ambulance
                  </div>

                  <div
                    style={{
                      padding:
                        "11px",
                      borderRadius:
                        "9px",
                      background:
                        "rgba(255, 23, 68, 0.14)",
                      border:
                        "1px solid rgba(255, 23, 68, 0.4)",
                      fontWeight:
                        "700",
                      lineHeight:
                        "1.4",
                    }}
                  >
                    🔊 Ambulance is
                    near. Please
                    clear the way.
                  </div>

                </div>
              )}

              {/* MAP LEGEND */}

              <div className="map-legend">

                <div>

                  <span className="legend-ambulance">
                    🚑
                  </span>

                  Ambulance

                </div>

                <div>

                  <span className="legend-vehicle">
                    🚗
                  </span>

                  Connected Vehicle

                </div>

                <div>

                  <span className="legend-circle"></span>

                  500 m Emergency
                  Corridor

                </div>

                <div>
                  🔊 Voice Alert
                </div>

              </div>

              {/* EXISTING ALERT OVERLAY */}

              {ambulance.emergency &&
                alertedVehicles.length >
                  0 && (
                  <div className="driver-alert-overlay">

                    <div className="alert-overlay-header">
                      🚨 VEHICLE ALERT
                    </div>

                    <div className="alert-main-message">
                      AMBULANCE APPROACHING
                    </div>

                    <small
                      style={{
                        display:
                          "block",
                        marginTop:
                          "8px",
                        color:
                          "#ffd166",
                        fontWeight:
                          "700",
                      }}
                    >
                      🔊 Voice alert sent
                      to connected
                      vehicles
                    </small>

                    <div className="alert-list">

                      {alertedVehicles
                        .slice(0, 6)
                        .map(
                          (
                            vehicle
                          ) => (
                            <div
                              className="alert-vehicle"
                              key={
                                vehicle.id
                              }
                            >

                              <strong>
                                {
                                  vehicle.id
                                }
                              </strong>

                              <span>
                                {Number(
                                  vehicle.distance ||
                                    0
                                ).toFixed(
                                  0
                                )}{" "}
                                m
                              </span>

                              <span>
                                {
                                  vehicle.position
                                }
                              </span>

                            </div>
                          )
                        )}

                    </div>

                  </div>
                )}

            </section>

            {/* =================================================
                STATISTICS
            ================================================= */}

            <section className="stats-grid">

              <div className="stat-card">

                <span className="stat-icon">
                  🚗
                </span>

                <div>

                  <small>
                    Connected Vehicles
                  </small>

                  <strong>
                    {
                      vehicles.length
                    }
                  </strong>

                </div>

              </div>

              <div className="stat-card">

                <span className="stat-icon">
                  ⚠️
                </span>

                <div>

                  <small>
                    Vehicles Alerted
                  </small>

                  <strong>
                    {
                      alertedVehicles.length
                    }
                  </strong>

                </div>

              </div>

              <div className="stat-card">

                <span className="stat-icon">
                  📍
                </span>

                <div>

                  <small>
                    Inside 500 m
                  </small>

                  <strong>
                    {
                      vehiclesInsideCorridor.length
                    }
                  </strong>

                </div>

              </div>

              <div className="stat-card">

                <span className="stat-icon">
                  🏥
                </span>

                <div>

                  <small>
                    Hospital Distance
                  </small>

                  <strong>
                    {hospitalDistance.toFixed(
                      2
                    )}{" "}
                    km
                  </strong>

                </div>

              </div>

            </section>

            {/* =================================================
                CLEARANCE QUEUE
            ================================================= */}

            <section className="clearance-panel">

              <div className="panel-header">

                <div>

                  <h2>
                    Vehicle Clearance
                    Queue
                  </h2>

                  <p>
                    Connected vehicles
                    that need to clear
                    the ambulance path
                  </p>

                </div>

                <span className="clear-warning">
                  {
                    alertedVehicles.length
                  }{" "}
                  NEED ACTION
                </span>

              </div>

              {alertedVehicles.length ===
              0 ? (

                <div className="empty-state">

                  <span>
                    ✅
                  </span>

                  <p>
                    No vehicles
                    currently need
                    clearance.
                  </p>

                </div>

              ) : (

                <div className="queue-grid">

                  {alertedVehicles.map(
                    (
                      vehicle
                    ) => (

                      <div
                        className="alert-vehicle"
                        key={
                          vehicle.id
                        }
                      >

                        <div>

                          <strong>
                            {
                              vehicle.id
                            }
                          </strong>

                          <small>
                            {
                              vehicle.type
                            }
                          </small>

                        </div>

                        <div>

                          <span>
                            {Number(
                              vehicle.distance ||
                                0
                            ).toFixed(
                              0
                            )}{" "}
                            m
                          </span>

                          <small>
                            {
                              vehicle.position
                            }
                          </small>

                        </div>

                        <div className="clear-warning">
                          🔊 CLEAR ROAD
                        </div>

                      </div>

                    )
                  )}

                </div>

              )}

            </section>

            {/* BOTTOM EMERGENCY */}

            {ambulance.emergency && (
              <div className="bottom-emergency">

                <div>

                  🚨

                  <strong>
                    EMERGENCY CORRIDOR
                    ACTIVE
                  </strong>

                </div>

                <span>
                  500 m radius •
                  Direction:{" "}
                  {
                    ambulance.directionName
                  }
                </span>

              </div>
            )}

          </>
        )}

        {/* =====================================================
            DRIVER VIEW
        ===================================================== */}

        {view ===
          "driver" && (
          <section className="driver-cards">

            {/* AMBULANCE INFO */}

            <div className="driver-info-card">

              <div className="driver-card-header">

                <span>
                  🚑 AMBULANCE
                </span>

                <span>
                  {
                    ambulance.id
                  }
                </span>

              </div>

              <div className="driver-info-grid">

                <div>

                  <small>
                    Speed
                  </small>

                  <strong>
                    {
                      ambulance.speed
                    }{" "}
                    km/h
                  </strong>

                </div>

                <div>

                  <small>
                    Direction
                  </small>

                  <strong>
                    {
                      ambulance.directionName
                    }
                  </strong>

                </div>

                <div>

                  <small>
                    Hospital
                  </small>

                  <strong>
                    {
                      hospital.name
                    }
                  </strong>

                </div>

                <div>

                  <small>
                    Distance
                  </small>

                  <strong>
                    {hospitalDistance.toFixed(
                      2
                    )}{" "}
                    km
                  </strong>

                </div>

                <div>

                  <small>
                    ETA
                  </small>

                  <strong>
                    {etaMinutes.toFixed(
                      1
                    )}{" "}
                    min
                  </strong>

                </div>

                <div>

                  <small>
                    Vehicles Nearby
                  </small>

                  <strong>
                    {
                      vehiclesInsideCorridor.length
                    }
                  </strong>

                </div>

              </div>

            </div>

            {/* TRAFFIC AHEAD */}

            <div className="driver-alert-section">

              <div className="driver-section-header">

                <h2>
                  ⚠️ Traffic Ahead
                </h2>

                <span>
                  {
                    alertedVehicles.length
                  }{" "}
                  vehicles
                </span>

              </div>

              {alertedVehicles.length ===
              0 ? (

                <div className="large-driver-alert">

                  <div className="alert-message-box safe">

                    <span>
                      ✅
                    </span>

                    <div>

                      <strong>
                        ROAD CLEAR
                      </strong>

                      <p>
                        No connected
                        vehicles
                        currently
                        require
                        clearance.
                      </p>

                    </div>

                  </div>

                </div>

              ) : (

                <div className="large-driver-alert">

                  <div className="alert-message-box danger">

                    <span>
                      🚨
                    </span>

                    <div>

                      <strong>
                        CLEAR THE WAY
                      </strong>

                      <p>
                        {
                          alertedVehicles.length
                        }{" "}
                        connected
                        vehicle(s)
                        detected near
                        the emergency
                        corridor.
                      </p>

                      <small
                        style={{
                          display:
                            "block",
                          color:
                            "#ffd166",
                          fontWeight:
                            "700",
                          marginTop:
                            "8px",
                        }}
                      >
                        🔊 “Ambulance is
                        near. Please
                        clear the way.”
                      </small>

                    </div>

                  </div>

                  <div className="driver-clear-now">

                    {alertedVehicles.map(
                      (
                        vehicle
                      ) => (

                        <div
                          key={
                            vehicle.id
                          }
                          className="driver-vehicle-row"
                        >

                          <div>

                            <strong>
                              {
                                vehicle.id
                              }
                            </strong>

                            <small>
                              {
                                vehicle.position
                              }
                            </small>

                          </div>

                          <div>

                            <strong>
                              {Number(
                                vehicle.distance ||
                                  0
                              ).toFixed(
                                0
                              )}{" "}
                              m
                            </strong>

                            <small>
                              Distance
                            </small>

                          </div>

                          <div className="clear-warning">
                            CLEAR
                          </div>

                        </div>

                      )
                    )}

                  </div>

                </div>

              )}

            </div>

            {/* DRIVER INSTRUCTION */}

            <div className="driver-bottom-warning">

              <strong>
                📢 DRIVER INSTRUCTION
              </strong>

              <p>
                Follow the highlighted
                emergency corridor and
                proceed toward the
                hospital. Connected
                vehicles are being
                alerted automatically.
                Voice warnings are
                triggered when a
                vehicle enters the
                500 m emergency
                corridor.
              </p>

            </div>

          </section>
        )}

      </main>

      {/* =====================================================
          SMALL ANIMATION FOR AUTOMATIC POPUP
      ===================================================== */}

      <style>
        {`
          @keyframes corridorAlertIn {
            from {
              opacity: 0;
              transform: translateY(-15px)
                scale(0.96);
            }

            to {
              opacity: 1;
              transform: translateY(0)
                scale(1);
            }
          }
        `}
      </style>

    </div>
  );
}

export default App;