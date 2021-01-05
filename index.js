const CBuffer = require(`cbuffer`)
const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`)
const Interpret = require(`./interpret`)

let packetBuffer = new CBuffer(100000) // only remember the last 100000 packets

let connection = new GuiConnection()

connection.on(`ready`, () => {

  console.log(`Connection with GUI established`)

  let parser = new PacketParser()
  let sendBuffer = []

  connection.on(`command`, (command) => {

    console.log(`Received command from GUI:`, command)
  
    switch (command[0]) {
      case `sendAll`:
        connection.send(packetBuffer.map(packet => Interpret.packet(packet))) // sends all packets inside the packetBuffer in simple format
        break;
      case `send`:

        if (!(command[1] >= 0)) {
          connection.send({
            type: `error`,
            value: `Missing packet ID while requesting specific packet!`,
          })
        }

        let foundPacket = packetBuffer.toArray().find(packet => {
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

        let count = packetBuffer.toArray().filter(packet => {
          // console.log(`packet._source.layers.nordic_ble:`, packet._source.layers.nordic_ble);
          return Number(packet._source.layers.btle[`btle.`]) !== 0
        }).length

        connection.send(`Packets with channel != 0: ${count}`)
    
      default:
        break;
    }
    
  })

  parser.on(`packet`, (packet) => {

    packetBuffer.push(packet)
    let simplePacket = Interpret.packet(packet)
    sendBuffer.push(simplePacket)

    if (sendBuffer.length >= 1000) {
      connection.send(sendBuffer)
      sendBuffer = []
    }

    
  })

  parser.on(`end`, () => {

    connection.send(sendBuffer)
    sendBuffer = []
    
  })
  
})

