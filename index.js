const http = require(`http`)

require('dotenv').config(); // loads environment variables from `.env` files
// improve logging capabilities: timestamps, log type, set log level, etc.
const betterLogging = require(`better-logging`)
betterLogging(console, {
  messageConstructionStrategy: betterLogging.MessageConstructionStrategy.FIRST,
})
console.logLevel = process.env.environment === `development` ? 4 : 3 // level 4 includes debug logs, 2 and below include info, warn and error

// import helper classes
const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`);

// create a http server to bind the websocket server to
// the websocket server *could* create its own server, but then it can't shared a port with other http-server stuff
// using a plain http server makes deployment easier, because we don't need to keep track of the WS port - just use the standard (http) port!
let server = http.createServer()
server.listen(process.env.PORT)
let connection = new GuiConnection(server) // initialize the GuiConnection class, which includes all WebSocket-related things
let parser = new PacketParser() // initialize the PacketParser class, which handles converting pcap-input into parsed JS objects

// emitted when the WebSocket server is ready to accept connections
connection.on(`ready`, () => {
  // register a handler function for messages of type `command`
  connection.on(`command`, handleCommand)
})

// fired whenever a client connects to the websocket
connection.on(`new-client`, (socketId) => {
  console.info(`Connection with client GUI established!\n  ID:`, socketId)
})

/**
 * ### Handles messages of type `command` received from clients
 * Differentiates between all different types of commands and responds with the requested data
 * @param {String} socketId The ID of the client/socket connection. Needed to respond to the correct client
 * @param {Array} command The command sent by the client. Index 0 contains the name of the command, all other indices include various payloads
 */
function handleCommand(socketId, command) {

  console.log(`Received command from GUI:`, command)

  /**
   * ### Command end reply
   * @returns a reply telling the client the command has been handled completely
   */
  let end = () => {
    return {
      type: `commandEnd`,
      value: [
        command[0],
      ]
    }
  }
  
  // a reply containing the data requested by the client
  // multiple responses can be sent per command
  // each command **has** to be finalized with an `end()` reply, once there is no more data to send
  /**
   * ### Command response reply
   * 
   * Multiple responses can be sent per command  
   * Each command **has** to be finalized with an `end()` reply, once there is no more data to send
   * @param {Object} payload the data requested by the client
   * @returns a reply containing the data requested by the client
   */
  let response = (payload) => {
    return {
      type: `response`,
      value: [
        command[0],
        payload,
      ]
    }
  }

  /**
   * ### Command error reply
   * 
   * A reply telling the client that there has been an error while fulfilling the command  
   * If the error is fatal, the command has to be ended by additionally sending an `end()` reply
   * @param {String} message a message describing what went wrong
   * @returns 
   */
  let error = (message) => {
    return {
      type: `error`,
      value: [
        command[0],
        message,
      ]
    }
  }

  // index 0 is the type/name of the command
  switch (command[0]) {
    // sends all packets in simple format
    case `sendAll`:

      connection.send(socketId, response(parser.packetBuffer.toArray().map(packet => packet.getInfo()))) // sends all packets inside the parser.packetBuffer in simple format
      connection.send(socketId, end())
      
      break;
    // sends a single packet. requires at least one payload (the packet id), accepts an additional payload (the packet format: `simple`, `full` or `raw`). if no format is specified it defaults to `simple`
    case `send`:

      if (!(command[1] >= 0)) {
        connection.send(socketId, error(`Missing packet ID while requesting specific packet!`))
        connection.send(end())
      }

      let foundPacket = parser.packetBuffer.toArray().find(packet => {
        return packet.info.packetId === command[1]
      })

      if (foundPacket) {

        console.debug(`foundPacket:`, foundPacket);
        // if `command[2]` is undefined it returns the default format of `Packet.getInfo()`
        connection.send(socketId, response(foundPacket.getInfo(command[2])))
        connection.send(socketId, end())
        
      } else {

        console.warn(`Couldn't find packet ${command[1]}, requested by client '${socketId}'!`)
        connection.send(error(`Packet with id ${command[1]} not found!`))
        connection.send(end())

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

      connection.send(socketId, response([...parser.advertisers.values()]))
      connection.send(socketId, end())

      break;

    case `issuesLive`:

      // parser.off(`new-issue`, sendIssues(socketId)) // make sure any previous handler is removed before attaching a new handler
      // parser.on(`new-issue`, sendIssues(socketId))

      connection.subscribe(socketId, command[0])
      
      break;

    case `issues`:

      connection.send(socketId, response(parser.issues))
      connection.send(socketId, end())

      break;

    case `end`:

      connection.unsubscribe(socketId, command[1])
      connection.send(socketId, response(`Success`))
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
    
    // console.log(`packetQueue:`, packetQueue)
    broadcastPackets(packetQueue)
    packetQueue.length = 0
    
  }

}, 50)

setInterval(() => {

  broadcastConnections([...parser.connections.values()]) // broadcast this regularly to keep # of packets up to date
  broadcastAdvertisers([...parser.advertisers.values()]) // broadcast this regularly to keep # of packets up to date
  
}, 500)

function addPacketToBroadcastQueue(packet) {
  let simplePacket = packet.getInfo()
  packetQueue.push(simplePacket)
}

function broadcastPacket(packet) {
  let simplePacket = packet.getSimpleInfo()
  try {
    connection.broadcast(`live`, {
      type: `response`,
      value: [
        `live`,
        [simplePacket],
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast packet:`, err)    
  }
}

function broadcastPackets(packets) {
  try {
    connection.broadcast(`live`, {
      type: `response`,
      value: [
        `live`,
        packets,
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast packets:`, err)    
  }
}

function broadcastConnections(connections) {
  try {
    connection.broadcast(`connectionsLive`, {
      type: `response`,
      value: [
        `connectionsLive`,
        connections,
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast connections:`, err)    
  }
}

function broadcastAdvertisers(advertisers) {
  try {
    connection.broadcast(`advertisersLive`, {
      type: `response`,
      value: [
        `advertisersLive`,
        advertisers,
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast advertisers:`, err)    
  }
}


function broadcastIssues(issues) {
  try {
    connection.broadcast(`issuesLive`, {
      type: `response`,
      value: [
        `issuesLive`,
        issues,
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast issues:`, err)
  }
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
