// Platform cut: 10% of total pot. Winner takes 90%.
const ROOMS = [
  { id:1,  name:"Starter Arena",  entry:100,   maxP:2, totalPot:200,   cut:20,   prize:180   },
  { id:2,  name:"Bronze Arena",   entry:200,   maxP:2, totalPot:400,   cut:40,   prize:360   },
  { id:3,  name:"Silver Arena",   entry:500,   maxP:2, totalPot:1000,  cut:100,  prize:900   },
  { id:4,  name:"Gold Arena",     entry:1000,  maxP:2, totalPot:2000,  cut:200,  prize:1800  },
  { id:5,  name:"Platinum Arena", entry:2000,  maxP:2, totalPot:4000,  cut:400,  prize:3600  },
  { id:6,  name:"Diamond Arena",  entry:5000,  maxP:2, totalPot:10000, cut:1000, prize:9000  },
  { id:7,  name:"Elite Arena",    entry:10000, maxP:2, totalPot:20000, cut:2000, prize:18000 },
  { id:8,  name:"Quad Bronze",    entry:500,   maxP:4, totalPot:2000,  cut:200,  prize:1800  },
  { id:9,  name:"Quad Gold",      entry:2000,  maxP:4, totalPot:8000,  cut:800,  prize:7200  },
  { id:10, name:"Quad Elite",     entry:5000,  maxP:4, totalPot:20000, cut:2000, prize:18000 },
];
const getRoom = id => ROOMS.find(r => r.id === Number(id));
module.exports = { ROOMS, getRoom };
