const http = require(`http`)

require('dotenv').config(); // loads environment variables from `.env` files
// improve logging capabilities: timestamps, log type, set log level, etc.
const betterLogging = require(`better-logging`)
betterLogging(console, {
  messageConstructionStrategy: betterLogging.MessageConstructionStrategy.FIRST,
})

switch (process.env.environment) {
  case `development`:
    console.logLevel = 3 // level 3 includes regular logs and everything from level 2
    break;
  case `debug`:
    console.logLevel = 4 // level 4 includes all logs, including debug
    break;
  default:
    console.logLevel = 2 // level 2 and below include info, warn and error
    break;
}

// import helper classes
const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`);
const Packet = require('./packet');

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

    // subscribes a client to live packets
    case `packetsLive`:

      connection.subscribe(socketId, command[0]) // adds a new subscription inside the GuiConnection, so that broadcasts for `packetsLive` are forwarded to this client
      
      break;

    // subscribes a client to live connections
    case `connectionsLive`:

      connection.subscribe(socketId, command[0]) // adds a new subscription inside the GuiConnection, so that broadcasts for `connectionsLive` are forwarded to this client
      
      break;

    // sends all known connections that exist or have existed to the client
    case `connections`:

      console.debug(`parser.connections:`, parser.connections);
      connection.send(socketId, response([...parser.connections.values()])) // `parser.connections` is a Map, so the spread operator (`...`) is used to convert it into an array
      connection.send(socketId, end())

      break;

    // subscribes a client to live advertisers
    case `advertisersLive`:

      connection.subscribe(socketId, command[0]) // adds a new subscription inside the GuiConnection, so that broadcasts for `advertisersLive` are forwarded to this client
      
      break;

    // sends all known advertisers that exist or have existed to the client
    case `advertisers`:

      connection.send(socketId, response([...parser.advertisers.values()])) // `parser.advertisers` is a Map, so the spread operator (`...`) is used to convert it into an array
      connection.send(socketId, end())

      break;

    // subscribes a client to live issues
    case `issuesLive`:

      connection.subscribe(socketId, command[0]) // adds a new subscription inside the GuiConnection, so that broadcasts for `issuesLive` are forwarded to this client
      
      break;

    // sends all detected issues to the client
    case `issues`:

      connection.send(socketId, response(parser.issues))
      connection.send(socketId, end())

      break;

    // used to end a subscription to a live/broadcast command
    case `end`:

      connection.unsubscribe(socketId, command[1]) // unsubscribe the client inside GuiConnection so that broadcasts aren't forwarded anymore
      connection.send(socketId, response(`Success`))
      connection.send(socketId, end())

      break;
  
    default:
      break;
  }
  
}

parser.on(`packet`, addPacketToBroadcastQueue) // packets aren't broadcasted directly, it's more efficient to queue them up and send multiple packets at a regular interval
parser.on(`new-connection`, broadcastConnections) // attach the broadcast handler for connections
parser.on(`new-advertiser`, broadcastAdvertisers) // attach the broadcast handler for advertisers
parser.on(`new-issue`, broadcastIssues) // attach the broadcast handler for issues

let packetQueue = []
// send packets at a regular interval. can be increased if packets are arriving to fast
setInterval(() => {

  if (packetQueue.length > 0) {
    
    console.debug(`packetQueue:`, packetQueue)
    broadcastPackets(packetQueue)
    packetQueue.length = 0 // clear the packet queue, very important :)
    
  }

}, 50)

// also regularly update packet counts for connections and advertisers, because else they would only change if a new connection or advertiser is detected, which is rather infrequent 
setInterval(() => {

  broadcastConnections([...parser.connections.values()]) // broadcast this regularly to keep number of packets inside the connection up to date
  broadcastAdvertisers([...parser.advertisers.values()]) // broadcast this regularly to keep number of packets from different advertisers up to date
  
}, 500)

/**
 * ### Handler for the `packet` event.  
 * takes a single packet and adds the packet (simple format) to the broadcast queue
 * @param {Packet} packet The packet emitted by the event
 */
function addPacketToBroadcastQueue(packet) {
  let simplePacket = packet.getInfo()
  packetQueue.push(simplePacket)
}

/**
 * Can be used to directly broadcast a single packet  
 * **not recommended** for medium to high frequency packet streams, but in theory offers the lowest latency
 * @param {Packet} packet The packet emitted by the event
 */
function broadcastPacket(packet) {
  let simplePacket = packet.getSimpleInfo()
  try {
    connection.broadcast(`packetsLive`, {
      type: `response`,
      value: [
        `packetsLive`,
        [simplePacket],
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast packet:`, err)    
  }
}

/**
 * ### Broadcast multiple packets at once
 * @param {Array<Packet>} packets All packets to be broadcasted
 */
function broadcastPackets(packets) {
  try {
    connection.broadcast(`packetsLive`, {
      type: `response`,
      value: [
        `packetsLive`,
        packets,
      ]
    })   
  } catch (err) {
    console.warn(`Failed to broadcast packets:`, err)    
  }
}

/**
 * ### Broadcast multiple connections at once
 * @param {Array<Object>} connections All connections to be broadcasted
 */
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

/**
 * ### Broadcast multiple advertisers at once
 * @param {Array<Object>} advertisers All advertisers to be broadcasted
 */
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

/**
 * ### Broadcast multiple issues at once
 * @param {Array<Object>} issues All issues to be broadcasted
 */
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
