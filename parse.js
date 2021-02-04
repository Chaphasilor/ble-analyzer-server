const StreamArray = require('stream-json/streamers/StreamArray');
const fs = require('fs');
const { spawn } = require(`child_process`)
const EventEmitter = require(`events`)
const CBuffer = require(`cbuffer`)

const Packet = require(`./packet`)

let connectionStartCounter = 0
let connectionEndCounter = 0
let connectionPacketCounter = 0

module.exports = class Parser extends EventEmitter {

  constructor() {

    super()

    this.packetBuffer = new CBuffer(100000) // only remember the last 100000 packets
    this.connections = new Map()
    this.advertisers = new Map()

    if (process.argv.length > 2) {
      this.inputStream = fs.createReadStream(process.argv[2])
    } else {
      this.inputStream = process.stdin
    }
    
    // tshark needs to be in PATH
    // '-i -': use interface 'pipe
    // '-T json': output packet info as JSON
    // '-x': include raw packet data with output
    this.tshark = spawn(`tshark`, [`-i`, `-`, `-T`, `json`, `-x`])
    
    this.pipeline = this.tshark.stdout
      .pipe(StreamArray.withParser());
    this.tshark.stdout.on('data', (data) => {
      // console.log(`stdout: ${data}`)
    });
    
    this.tshark.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`)
    });
    this.inputStream.pipe(this.tshark.stdin)
    
    this.pipeline.on('data', data => {
    
      // console.log(data.value)
      let packet = new Packet(data.value)
      this.packetBuffer.push(packet)
      this.emit(`packet`, packet)
      let connection = packet.getConnectionInfo()

      //TODO is connection detection logic working properly? compare with older commits, is there really only one actual connection?!
      // if the packet contains a connection and the connection hasn't been included before, emit the event
      if (connection) {

        if (connection.state === `start`) {

          console.log(`++connectionStartCounter:`, ++connectionStartCounter)

          if (this.connections.has(connection.accessAddress)) {

            let oldConnection = this.connections.get(connection.accessAddress)
            console.log(`Old connection:`, oldConnection)
            console.log(`New connection:`, connection)

            if (this.connections.get(connection.accessAddress).state !== `active`) {

              console.warn(`Beginning of connection detected even though connection is active! Adding packets...`)

              connection.packets += oldConnection.packets // maybe only the connection properties changed, so we want to remember all previous packets as well

            } else {
              console.warn(`Beginning of connection detected, connection exists but isn't active! Overwriting...`)
            }

          } else 

          this.connections.set(connection.accessAddress, connection)

          this.emit(`new-connection`, [...this.connections.values()])
          
        } else if (connection.state === `end`) {

          console.log(`++connectionEndCounter:`, ++connectionEndCounter)

          if (this.connections.has(connection.accessAddress)) {

            this.connections.get(connection.accessAddress).state = connection.state
            
          } else {
            console.error(`End of connection detected but connection doesn't exists yet! Ignoring...`)
          }
          
        } else {

          if (this.connections.has(connection.accessAddress)) {

            console.log(`++connectionPacketCounter:`, ++connectionPacketCounter)

            let activeConnection = this.connections.get(connection.accessAddress)
            activeConnection.state = `active`
            activeConnection.packets += 1

            console.log(`activeConnection.packets:`, activeConnection.packets)
            
          } else {
            console.error(`Connection packet detected but connection doesn't exist yet! Discarding...`)
          }
          
        }
        

      }

      let advertisement = packet.getAdvertisementInfo()

      if (advertisement) {

        if (this.advertisers.has(advertisement.advertisingAddress)) {
          this.advertisers.get(advertisement.advertisingAddress).packets += 1
        } else {

          advertisement.packets = 1;
          this.advertisers.set(advertisement.advertisingAddress, advertisement)
          this.emit(`new-advertiser`, [...this.advertisers.values()])

        }

      }
      
    });
    
    this.pipeline.on(`close`, () => {

      console.log(`Done`)
      this.emit(`end`)

    })
    
  }
  
}
