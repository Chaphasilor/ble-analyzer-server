const http = require(`http`)
require(`dotenv`).config()

const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`)
const Packet = require(`./packet`)

let server = http.createServer()
server.listen(process.env.PORT)
let connection = new GuiConnection(server)
let parser = new PacketParser()


connection.on(`ready`, () => {

  console.log(`Connection with GUI established`)

  connection.on(`command`, handleCommand)

  connection.on(`close`, () => {
    console.log(`unlinking listener`)
    connection.off(`command`, handleCommand)
  })

})

function handleCommand(socketId, command) {

  console.log(`Received command from GUI:`, command)

  let end = () => {
    return {
      type: `commandEnd`,
      value: [
        command[0],
      ]
    }
  }
  
  let response = (payload) => {
    return {
      type: `response`,
      value: [
        command[0],
        payload,
      ]
    }
  }

  let error = (reason) => {
    return {
      type: `error`,
      value: [
        command[0],
        reason,
      ]
    }
  }

  switch (command[0]) {
    case `sendAll`:

      console.log(`parser.packetBuffer.toArray().length:`, parser.packetBuffer.toArray().length);
      connection.send(socketId, response(parser.packetBuffer.toArray().map(packet => packet.getInfo()))) // sends all packets inside the parser.packetBuffer in simple format
      connection.send(socketId, end())
      
      break;
    case `send`:

      if (!(command[1] >= 0)) {
        connection.send(socketId, error(`Missing packet ID while requesting specific packet!`))
      }

      let foundPacket = parser.packetBuffer.toArray().find(packet => {
        return packet.info.packetId === command[1]
      })

      if (foundPacket) {

        console.log(`foundPacket:`, foundPacket);
        connection.send(socketId, response(foundPacket.getInfo(command[2])))
        connection.send(socketId, end())
        
      } else {

        console.log(`Requested packet not found!`)
        connection.send(error(`Packet with id ${command[1]} not found!`))

      }
    
      break;

    case `live`:

      // parser.off(`packet`, sendLivePacketSummary(socketId)) // make sure any previous handler is removed before attaching a new handler
      // parser.on(`packet`, sendLivePacketSummary(socketId))

      connection.subscribe(socketId, command[0])
      
      break;

    case `connectionsLive`:

      // parser.off(`new-connection`, sendConnections(socketId)) // make sure any previous handler is removed before attaching a new handler
      // parser.on(`new-connection`, sendConnections(socketId))

      connection.subscribe(socketId, command[0])
      
      break;

    case `connections`:

      console.log(`parser.connections:`, parser.connections);
      connection.send(socketId, response([...parser.connections.values()]))
      connection.send(socketId, end())

      break;

    case `advertisersLive`:

      // parser.off(`new-advertiser`, sendAdvertisers(socketId)) // make sure any previous handler is removed before attaching a new handler
      // parser.on(`new-advertiser`, sendAdvertisers(socketId))

      connection.subscribe(socketId, command[0])
      
      break;

    case `advertisers`:

      console.log(`parser.advertisers:`, parser.advertisers);
      connection.send(socketId, response([...parser.advertisers.values()]))
      connection.send(socketId, end())

      break;

    case `issuesLive`:

      // parser.off(`new-issue`, sendIssues(socketId)) // make sure any previous handler is removed before attaching a new handler
      // parser.on(`new-issue`, sendIssues(socketId))

      connection.subscribe(socketId, command[0])
      
      break;

    case `issues`:

      console.log(`parser.issues:`, parser.issues);
      connection.send(socketId, response(parser.issues))
      connection.send(socketId, end())

      break;
  
    default:
      break;
  }
  
}

parser.on(`packet`, addPacketToBroadcastQueue)
// parser.on(`packet`, broadcastPacket)
parser.on(`new-connection`, broadcastConnections)
parser.on(`new-advertiser`, broadcastAdvertisers)
parser.on(`new-issue`, broadcastIssues)

let packetQueue = []

setInterval(() => {

  // console.log(`Checking packet queue...`)
  
  if (packetQueue.length > 0) {
    
    console.log(`packetQueue:`, packetQueue)
    broadcastPackets(packetQueue)
    packetQueue.length = 0
    
  }

  broadcastConnections([...parser.connections.values()]) // broadcast this regularly to keep # of packets up to date
  broadcastAdvertisers([...parser.advertisers.values()]) // broadcast this regularly to keep # of packets up to date
  
}, 50)

function addPacketToBroadcastQueue(packet) {
  let simplePacket = packet.getInfo()
  packetQueue.push(simplePacket)
}

function broadcastPacket(packet) {
  let simplePacket = packet.getSimpleInfo()
  connection.broadcast(`live`, {
    type: `response`,
    value: [
      `live`,
      [simplePacket],
    ]
  })
}

function broadcastPackets(packets) {
  connection.broadcast(`live`, {
    type: `response`,
    value: [
      `live`,
      packets,
    ]
  })  
}

function broadcastConnections(connections) {
  connection.broadcast(`connectionsLive`, {
    type: `response`,
    value: [
      `connectionsLive`,
      connections,
    ]
  })
}

function broadcastAdvertisers(advertisers) {
  connection.broadcast(`advertisersLive`, {
    type: `response`,
    value: [
      `advertisersLive`,
      advertisers,
    ]
  })
}


function broadcastIssues(issues) {
  connection.broadcast(`issuesLive`, {
    type: `response`,
    value: [
      `issuesLive`,
      issues,
    ]
  })
}

function sendLivePacketSummary(socketId, packet) {
  return (packet) => {
    let simplePacket = packet.getInfo()
    connection.send({
      type: `response`,
      value: [
        `live`,
        [simplePacket],
      ]
    })
  }
}

function sendConnections(socketId, connections) {
  (connections) => {
    connection.send({
      type: `response`,
      value: [
        `connectionsLive`,
        connections,
      ]
    })
  }
}

function sendAdvertisers(socketId, advertisers) {
  (advertisers) => {
    connection.send({
      type: `response`,
      value: [
        `advertisersLive`,
        advertisers,
      ]
    })
  }
}

function sendIssues(socketId, issues) {
  (issues) => {
    connection.send({
      type: `response`,
      value: [
        `issuesLive`,
        issues,
      ]
    })
  }
}
