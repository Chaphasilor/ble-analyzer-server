const CBuffer = require(`cbuffer`)
const PacketParser = require(`./parse`)
const GuiConnection = require(`./gui-connection`)
const Interpret = require(`./interpret`)

let packetBuffer = new CBuffer(100000) // only remember the last 100000 packets

let connection = new GuiConnection()

connection.on(`ready`, () => {

  console.log(`Connection with GUI established`)

  let parser = new PacketParser()

  parser.on(`packet`, (packet) => {

    packetBuffer.push(packet)
    let simplePacket = Interpret.packet(packet)
    connection.send(simplePacket)
    
  })
  
})

connection.on(`message`, (data) => {
  console.log(`Recieved message from GUI:`, data)
})
