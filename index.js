const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`)
const Packet = require(`./packet`)

let connection = new GuiConnection()
let parser = new PacketParser()

connection.on(`ready`, () => {

  console.log(`Connection with GUI established`)

  connection.on(`command`, handleCommand)

  connection.on(`close`, () => {
    console.log(`unlinking listener`)
    connection.off(`command`, handleCommand)
  })

})

function handleCommand(command) {

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
      connection.send(response(parser.packetBuffer.toArray().map(packet => packet.getInfo()))) // sends all packets inside the parser.packetBuffer in simple format
      connection.send(end())
      
      break;
    case `send`:

      if (!(command[1] >= 0)) {
        connection.send(error(`Missing packet ID while requesting specific packet!`))
      }

      let foundPacket = parser.packetBuffer.toArray().find(packet => {
        return packet.info.packetId === command[1]
      })

      if (foundPacket) {

        console.log(`foundPacket:`, foundPacket);
        connection.send(response(foundPacket.getInfo(command[2])))
        connection.send(end())
        
      } else {

        console.log(`Requested packet not found!`)
        connection.send(error(`Packet with id ${command[1]} not found!`))

      }
    
      break;

    case `live`:

      parser.off(`packet`, sendLivePacketSummary) // make sure any previous handler is removed before attaching a new handler
      parser.on(`packet`, sendLivePacketSummary)

      break;

    case `connectionsLive`:

      parser.off(`new-connection`, sendConnections) // make sure any previous handler is removed before attaching a new handler
      parser.on(`new-connection`, sendConnections)

      break;

    case `connections`:

      console.log(`parser.connections:`, parser.connections);
      connection.send(response([...parser.connections.values()]))
      connection.send(end())

      break;

    case `advertisersLive`:

      parser.off(`new-advertiser`, sendAdvertisers) // make sure any previous handler is removed before attaching a new handler
      parser.on(`new-advertiser`, sendAdvertisers)

      break;

    case `advertisers`:

      console.log(`parser.advertisers:`, parser.advertisers);
      connection.send(response([...parser.advertisers.values()]))
      connection.send(end())

      break;

    case `issuesLive`:

      parser.off(`new-issue`, sendIssues) // make sure any previous handler is removed before attaching a new handler
      parser.on(`new-issue`, sendIssues)

      break;

    case `issues`:

      console.log(`parser.issues:`, parser.issues);
      connection.send(response(parser.issues))
      connection.send(end())

      break;
  
    default:
      break;
  }
  
}

function sendLivePacketSummary(packet) {

  let simplePacket = packet.getInfo()
  connection.send({
    type: `response`,
    value: [
      `live`,
      [simplePacket],
    ]
  })
  
}

function sendConnections(connections) {

  connection.send({
    type: `response`,
    value: [
      `connectionsLive`,
      connections,
    ]
  })
  
}

function sendAdvertisers(advertisers) {

  connection.send({
    type: `response`,
    value: [
      `advertisersLive`,
      advertisers,
    ]
  })
  
}

function sendIssues(issues) {

  connection.send({
    type: `response`,
    value: [
      `issuesLive`,
      issues,
    ]
  })
  
}
