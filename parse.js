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
    this.issues = []

    // this.packetEmitQueue = []

    // setInterval(() => {
    //   if (this.packetEmitQueue.length > 0) {
    //     this.emit(`packet`, this.packetEmitQueue.shift())
    //   }
    // }, 25)

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
      // this.packetEmitQueue.push(packet)
      this.packetBuffer.push(packet)
      this.emit(`packet`, packet)

      if (packet.info.malformed) {
        this.issues.push({
          type: `error`,
          microseconds: packet.info.microseconds,
          message: `Packet is malformed!`,
        })
        this.emit(`new-issue`, this.issues)
      }

      if (!packet.info.crcOk) {
        this.issues.push({
          type: `error`,
          microseconds: packet.info.microseconds,
          message: `Packet CRC isn't correct!`,
        })
        this.emit(`new-issue`, this.issues)
      }
      
      let connection = packet.getConnectionInfo()

      //TODO is connection detection logic working properly? compare with older commits, is there really only one actual connection?!
      // if the packet contains a connection and the connection hasn't been included before, emit the event
      if (connection) {

        if (connection.state === `start`) {

          console.log(`++connectionStartCounter:`, ++connectionStartCounter)

          // console.log(`connection.properties:`, connection.properties)
          
          if (this.connections.has(connection.accessAddress)) {

            let oldConnection = this.connections.get(connection.accessAddress)
            // console.log(`Old connection:`, oldConnection)
            // console.log(`New connection:`, connection)

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

            let existingConnection = this.connections.get(connection.accessAddress)
            existingConnection.state = connection.state

            if (existingConnection.packets % 2 !== 0) {
              this.issues.push({
                type: `warning`,
                microseconds: connection.microseconds,
                message: `[${connection.accessAddress}] Odd number of connection events before end of connection!`,
              })
              this.emit(`new-issue`, this.issues)
            }
            
          } else {
            console.error(`End of connection detected but connection doesn't exists yet! Ignoring...`)
          }
          
        } else {

          if (this.connections.has(connection.accessAddress)) {

            // console.log(`++connectionPacketCounter:`, ++connectionPacketCounter)

            let activeConnection = this.connections.get(connection.accessAddress)

            let timeSinceLastSlavePacket = (connection.microseconds - activeConnection.lastPackets[`S2M`])
            // check if slave has timed out (but not necessarily lost)
            // latency + 1 because the latency can be set to 0 to disallow skipping intervals
            // TODO it's detecting too many issues
            if (activeConnection.properties.connectionInterval * 1250 * (activeConnection.properties.slaveLatency + 1) < timeSinceLastSlavePacket) {

              if (activeConnection.properties.supervisionTimeout * 10000 < timeSinceLastSlavePacket) {
                this.issues.push({
                  type: `alert`,
                  microseconds: connection.microseconds,
                  message: `[${connection.accessAddress}] Connection seems to be lost!`,
                })
              } else {
                // disabled because it's a bit too verbose

                // this.issues.push({
                //   type: `warning`,
                //   microseconds: connection.microseconds,
                //   message: `[${connection.accessAddress}] Slave has timed out!`,
                // })
              }

              this.emit(`new-issue`, this.issues)

            }
            
            activeConnection.state = `active`
            activeConnection.packets += 1
            activeConnection.distribution[connection.direction] += 1
            activeConnection.lastPackets[connection.direction] = connection.microseconds

            // console.log(`activeConnection.packets:`, activeConnection.packets)
            
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
