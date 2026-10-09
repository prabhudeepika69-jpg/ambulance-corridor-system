const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

const PORT = 5000;
const CORRIDOR_RADIUS = 500;

// ======================================================
// AMBULANCE
// ======================================================

const ambulance = {
  id: "AMB-001",
  latitude: 12.9716,
  longitude: 77.5946,
  speed: 60,
  direction: 0,
  directionName: "NORTH",
  emergency: false,
  sessionId: null,
};

// ======================================================
// SIMULATED CONNECTED VEHICLES
// ======================================================

const vehicles = [
  {
    id: "CAR-01",
    type: "CAR",
    latitude: 12.9725,
    longitude: 77.5946,
    speed: 35,
    direction: 0,
  },

  {
    id: "CAR-02",
    type: "CAR",
    latitude: 12.9732,
    longitude: 77.5947,
    speed: 30,
    direction: 0,
  },

  {
    id: "CAR-03",
    type: "CAR",
    latitude: 12.9739,
    longitude: 77.5945,
    speed: 40,
    direction: 0,
  },

  {
    id: "CAR-04",
    type: "CAR",
    latitude: 12.9746,
    longitude: 77.5946,
    speed: 25,
    direction: 0,
  },

  {
    id: "CAR-05",
    type: "CAR",
    latitude: 12.9753,
    longitude: 77.5947,
    speed: 35,
    direction: 0,
  },

  {
    id: "CAR-06",
    type: "CAR",
    latitude: 12.976,
    longitude: 77.5945,
    speed: 30,
    direction: 0,
  },

  {
    id: "CAR-07",
    type: "CAR",
    latitude: 12.9717,
    longitude: 77.5955,
    speed: 35,
    direction: 90,
  },

  {
    id: "CAR-08",
    type: "CAR",
    latitude: 12.9724,
    longitude: 77.5956,
    speed: 40,
    direction: 90,
  },

  {
    id: "BUS-01",
    type: "BUS",
    latitude: 12.9733,
    longitude: 77.596,
    speed: 25,
    direction: 90,
  },

  {
    id: "CAR-09",
    type: "CAR",
    latitude: 12.9715,
    longitude: 77.5937,
    speed: 30,
    direction: 270,
  },

  {
    id: "CAR-10",
    type: "CAR",
    latitude: 12.9723,
    longitude: 77.5936,
    speed: 35,
    direction: 270,
  },

  {
    id: "AUTO-01",
    type: "AUTO",
    latitude: 12.9731,
    longitude: 77.5935,
    speed: 20,
    direction: 270,
  },

  {
    id: "CAR-11",
    type: "CAR",
    latitude: 12.9708,
    longitude: 77.5946,
    speed: 35,
    direction: 180,
  },

  {
    id: "CAR-12",
    type: "CAR",
    latitude: 12.9701,
    longitude: 77.5947,
    speed: 40,
    direction: 180,
  },

  {
    id: "TRUCK-01",
    type: "TRUCK",
    latitude: 12.9694,
    longitude: 77.5946,
    speed: 25,
    direction: 180,
  },
];

// ======================================================
// DISTANCE CALCULATION
// ======================================================

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;

  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLon / 2) ** 2;

  const c =
    2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ======================================================
// RELATIVE POSITION
// ======================================================

function getRelativePosition(vehicle) {
  const latDifference =
    (vehicle.latitude - ambulance.latitude) * 111000;

  const longitudeScale =
    Math.cos((ambulance.latitude * Math.PI) / 180);

  const lonDifference =
    (vehicle.longitude - ambulance.longitude) *
    111000 *
    longitudeScale;

  let forwardDistance = 0;
  let lateralDistance = 0;

  switch (ambulance.direction) {
    case 0:
      forwardDistance = latDifference;
      lateralDistance = lonDifference;
      break;

    case 90:
      forwardDistance = lonDifference;
      lateralDistance = -latDifference;
      break;

    case 180:
      forwardDistance = -latDifference;
      lateralDistance = -lonDifference;
      break;

    case 270:
      forwardDistance = -lonDifference;
      lateralDistance = latDifference;
      break;

    default:
      forwardDistance = latDifference;
      lateralDistance = lonDifference;
  }

  let position = "BEHIND";

  if (forwardDistance > 0) {
    if (Math.abs(lateralDistance) < 100) {
      position = "AHEAD";
    } else if (lateralDistance > 0) {
      position = "RIGHT";
    } else {
      position = "LEFT";
    }
  }

  return {
    forwardDistance,
    lateralDistance,
    position,
  };
}

// ======================================================
// EMERGENCY CORRIDOR CHECK
// ======================================================

function isInsideEmergencyCorridor(vehicle) {
  if (!ambulance.emergency) {
    return false;
  }

  const relative = getRelativePosition(vehicle);

  return (
    relative.forwardDistance > 0 &&
    relative.forwardDistance <= CORRIDOR_RADIUS &&
    Math.abs(relative.lateralDistance) <= 75
  );
}

// ======================================================
// UPDATE VEHICLES
// ======================================================

function updateVehicles() {
  vehicles.forEach((vehicle) => {
    const distance = calculateDistance(
      ambulance.latitude,
      ambulance.longitude,
      vehicle.latitude,
      vehicle.longitude
    );

    const relative = getRelativePosition(vehicle);

    vehicle.distance = Math.round(distance);

    vehicle.forwardDistance =
      Math.round(relative.forwardDistance);

    vehicle.lateralDistance =
      Math.round(relative.lateralDistance);

    vehicle.position = relative.position;

    vehicle.alert =
      isInsideEmergencyCorridor(vehicle);

    if (vehicle.alert && ambulance.speed > 0) {
      vehicle.etaToAmbulance = Math.round(
        (distance / (ambulance.speed * 1000)) * 60
      );
    } else {
      vehicle.etaToAmbulance = null;
    }
  });
}

// ======================================================
// SYSTEM DATA
// ======================================================

function getSystemData() {
  updateVehicles();

  const alertedVehicles = vehicles.filter(
    (vehicle) => vehicle.alert
  );

  return {
    ambulance: {
      ...ambulance,
    },

    vehicles: vehicles.map((vehicle) => ({
      ...vehicle,
    })),

    corridor: {
      active: ambulance.emergency,
      radius: CORRIDOR_RADIUS,
    },

    alertedVehicles: alertedVehicles.length,

    timestamp: new Date().toISOString(),
  };
}

// ======================================================
// BASIC API
// ======================================================

app.get("/", (req, res) => {
  res.json({
    message: "Dynamic Emergency Corridor Backend",
    status: "running",
  });
});

app.get("/api/status", (req, res) => {
  res.json(getSystemData());
});

// ======================================================
// SOCKET.IO
// ======================================================

io.on("connection", (socket) => {
  console.log(
    "Frontend connected:",
    socket.id
  );

  socket.emit(
    "systemData",
    getSystemData()
  );

  // --------------------------------------------------
  // START EMERGENCY
  // --------------------------------------------------

  socket.on("startEmergency", () => {
    ambulance.emergency = true;

    ambulance.sessionId =
      "EMG-" + Date.now();

    console.log(
      "🚨 Emergency started:",
      ambulance.sessionId
    );

    io.emit(
      "systemData",
      getSystemData()
    );
  });

  // --------------------------------------------------
  // STOP EMERGENCY
  // --------------------------------------------------

  socket.on("stopEmergency", () => {
    ambulance.emergency = false;

    ambulance.sessionId = null;

    console.log(
      "Emergency ended"
    );

    io.emit(
      "systemData",
      getSystemData()
    );
  });

  // --------------------------------------------------
  // MOVE NORTH
  // --------------------------------------------------

  socket.on("moveNorth", () => {
    ambulance.direction = 0;
    ambulance.directionName = "NORTH";
    ambulance.speed = 60;

    ambulance.latitude += 0.001;

    io.emit(
      "systemData",
      getSystemData()
    );
  });

  // --------------------------------------------------
  // MOVE SOUTH
  // --------------------------------------------------

  socket.on("moveSouth", () => {
    ambulance.direction = 180;
    ambulance.directionName = "SOUTH";
    ambulance.speed = 60;

    ambulance.latitude -= 0.001;

    io.emit(
      "systemData",
      getSystemData()
    );
  });

  // --------------------------------------------------
  // MOVE EAST
  // --------------------------------------------------

  socket.on("moveEast", () => {
    ambulance.direction = 90;
    ambulance.directionName = "EAST";
    ambulance.speed = 60;

    ambulance.longitude += 0.001;

    io.emit(
      "systemData",
      getSystemData()
    );
  });

  // --------------------------------------------------
  // MOVE WEST
  // --------------------------------------------------

  socket.on("moveWest", () => {
    ambulance.direction = 270;
    ambulance.directionName = "WEST";
    ambulance.speed = 60;

    ambulance.longitude -= 0.001;

    io.emit(
      "systemData",
      getSystemData()
    );
  });

  // --------------------------------------------------
  // DISCONNECT
  // --------------------------------------------------

  socket.on("disconnect", () => {
    console.log(
      "Frontend disconnected:",
      socket.id
    );
  });
});

// ======================================================
// START SERVER
// ======================================================

server.listen(PORT, () => {
  console.log(
    `🚑 Dynamic Emergency Corridor Backend running on http://localhost:${PORT}`
  );
});