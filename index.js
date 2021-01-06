const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`)
const Interpret = require(`./interpret`)

let connection = new GuiConnection()
let parser = new PacketParser()
let sendBuffer = []

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

  switch (command[0]) {
    case `sendAll`:
      console.log(`parser.packetBuffer.toArray().length:`, parser.packetBuffer.toArray().length);
      connection.send(parser.packetBuffer.toArray().map(packet => Interpret.packet(packet))) // sends all packets inside the parser.packetBuffer in simple format
      break;
    case `send`:

      if (!(command[1] >= 0)) {
        connection.send({
          type: `error`,
          value: `Missing packet ID while requesting specific packet!`,
        })
      }

      let foundPacket = parser.packetBuffer.toArray().find(packet => {
        return Number(packet._source.layers.frame[`frame.number`]) == command[1]
      })

      if (foundPacket) {

        console.log(`foundPacket:`, foundPacket);
        connection.send(Interpret.packet(foundPacket, command[2]))
        
      } else {

        console.log(`Requested packet not found!`)
        connection.send({
          type: `error`,
          value: `Packet with id ${command[1]} not found!`,
        })

      }
    
      break;

    case `count`:

      let count = parser.packetBuffer.toArray().filter(packet => {
        // console.log(`packet._source.layers.nordic_ble:`, packet._source.layers.nordic_ble);
        return Number(packet._source.layers.btle[`btle.`]) !== 0
      }).length

      connection.send(`Packets with channel != 0: ${count}`)
      
      break;

    case `live`:

      parser.off(`packet`, sendPacketSummary)
      parser.on(`packet`, sendPacketSummary)

      break;
  
    default:
      break;
  }
  
}

function sendPacketSummary(packet) {

  let simplePacket = Interpret.packet(packet)
  connection.send([simplePacket])
  
}