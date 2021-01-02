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

connection.on(`message`, (data) => {
  console.log(`Recieved message from GUI:`, data)
})
