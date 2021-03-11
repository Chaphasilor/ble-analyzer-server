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
    
    this.packetPipeline = this.tshark.stdout
      .pipe(StreamArray.withParser());

    this.tshark.stdout.on('data', (data) => {
      // console.log(`stdout: ${data}`)
    });
    this.tshark.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`)
    });

    this.inputStream.pipe(this.tshark.stdin)
    
    this.packetPipeline.on('data', data => {
    
      // console.log(data.value)
      let packet = new Packet(data.value)
      // this.packetEmitQueue.push(packet)
      this.packetBuffer.push(packet)
      this.emit(`packet`, packet)

      if (packet.info.malformed) {
        this.createIssue({
          type: `error`,
          microseconds: packet.info.microseconds,
          message: `Packet seems to be malformed!`,
        })
      }

      if (!packet.info.crcOk) {
        this.createIssue({
          type: `warning`,
          microseconds: packet.info.microseconds,
          message: `Packet CRC seems to be incorrect!`,
        })
      }
      
      let connection = packet.getConnectionInfo()

      if (connection) {
        this.handleConnectionPackets(packet, connection)
      }
      
      let advertisement = packet.getAdvertisementInfo()

      if (advertisement) {
        this.handleAdvertisementPackets(packet, advertisement)
      }
      
    });
    
    this.packetPipeline.on(`close`, () => {

      console.log(`Parsed all packets!`)
      this.emit(`end`)

    })
    
  }

  handleConnectionPackets(packet, connection) {

    // if the packet is either a) the beginning of a connection b) part of a connection or c) the end of a connection, handle it here
    // connection 

    switch (connection.state) {
      case `start`:
        
        console.log(`++connectionStartCounter:`, ++connectionStartCounter)

        // console.log(`connection.properties:`, connection.properties)
        
        if (this.connections.has(connection.accessAddress)) {

          let oldConnection = this.connections.get(connection.accessAddress)
          // console.log(`Old connection:`, oldConnection)
          // console.log(`New connection:`, connection)

          if (oldConnection.state === `active`) {

            console.warn(`Beginning of connection detected even though connection is active! Adding packets...`)

            connection.packets += oldConnection.packets // maybe only the connection properties changed, so we want to remember all previous packets as well
            connection.distribution.M2S += oldConnection.distribution.M2S
            connection.distribution.S2M += oldConnection.distribution.S2M

            this.createIssue({
              type: `warning`,
              microseconds: connection.microseconds,
              message: `[${connection.accessAddress}] Master seems to be trying to reconnect!`,
            })

          } else {
            console.warn(`Beginning of connection detected, connection exists but isn't active! Overwriting...`)
          }

        }

        this.connections.set(connection.accessAddress, connection)

        this.emit(`new-connection`, [...this.connections.values()])
      
        break;

      case `end`:

        console.log(`++connectionEndCounter:`, ++connectionEndCounter)

        // this.createIssue({
        //   type: `end`,
        //   microseconds: connection.microseconds,
        //   message: `[${connection.accessAddress}] Connection seems to have ended!`,
        // })

        if (this.connections.has(connection.accessAddress)) {

          let existingConnection = this.connections.get(connection.accessAddress)
          existingConnection.state = connection.state

          // this only applies to frames within a connection event, which aren't exposed by Wireshark
          // if (existingConnection.packets % 2 !== 0) {
          //   this.createIssue({
          //     type: `warning`,
          //     microseconds: connection.microseconds,
          //     message: `[${connection.accessAddress}] Odd number of connection events before end of connection!`,
          //   })
          // }
          
        } else {
          console.error(`End of connection detected but connection doesn't exists yet! Ignoring...`, packet)
        }
      
        break;
    
      default: // `active`

        if (this.connections.has(connection.accessAddress)) {

          // console.log(`++connectionPacketCounter:`, ++connectionPacketCounter)
  
          let activeConnection = this.connections.get(connection.accessAddress)
  
          // check if there was a previous packet from slave at all
          if (!isNaN(activeConnection.lastPackets[`S2M`])) {
  
            let timeSinceLastSlavePacket = (connection.microseconds - activeConnection.lastPackets[`S2M`])
            // check if slave has timed out (but not necessarily lost)
            // latency + 1 because the latency can be set to 0 to disallow skipping intervals
            if (activeConnection.properties.connectionInterval * 1250 * (activeConnection.properties.slaveLatency + 1) < timeSinceLastSlavePacket) {
  
              if (activeConnection.properties.supervisionTimeout * 10000 < timeSinceLastSlavePacket) {
                this.createIssue({
                  type: `alert`,
                  microseconds: connection.microseconds,
                  message: `[${connection.accessAddress}] Connection seems to be lost!`,
                })
              } else {
                // disabled because it's a bit too verbose
  
                // this.createIssue({
                //   type: `warning`,
                //   microseconds: connection.microseconds,
                //   message: `[${connection.accessAddress}] Slave has timed out!`,
                // })
              }
  
            }
  
          }
          
          activeConnection.state = `active`
          activeConnection.packets += 1
          activeConnection.distribution[connection.direction] += 1
          activeConnection.lastPackets[connection.direction] = connection.microseconds
  
          // console.log(`activeConnection.packets:`, activeConnection.packets)
          
        } else {
  
          console.warn(`Connection packet detected but connection doesn't exist yet! Creating connection...`)
          console.log(`packet.info.packetId:`, packet.info.packetId)
  
          this.createIssue({
            type: `warning`,
            microseconds: connection.microseconds,
            message: `[${connection.accessAddress}] Connection packet detected, but didn't detect the beginning of the connection!`,
          })
          
          
          let enrichedConnection = packet.enrichConnectionInfo(connection)
          
          // the connection won't have connection properties until it is restarted while sniffing, so timeouts can't be checked
          // there might also be some packets that are currently treated like being part of a connection, even though they aren't really
          // those packets will also start a connection for now
          this.connections.set(connection.accessAddress, enrichedConnection)
          this.emit(`new-connection`, [...this.connections.values()])
          
        }
      
        break;
    }
        
  }

  handleAdvertisementPackets(packet, advertisement) {

    if (this.advertisers.has(advertisement.advertisingAddress)) {
      this.advertisers.get(advertisement.advertisingAddress).packets += 1
    } else {

      advertisement.packets = 1;
      this.advertisers.set(advertisement.advertisingAddress, advertisement)
      this.emit(`new-advertiser`, [...this.advertisers.values()])

    }
    
  }

  /**
   * Create a new issue and re-emit all issues
   * @param {Object} properties 
   * @param {Number} properties.microseconds The microseconds (epoch) when the issue occurred
   * @param {String} properties.type The type of the issue (warning, alert)
   * @param {String} properties.message A description of the issue
   */
  createIssue(properties) {
    this.issues.push(properties)
    this.emit(`new-issue`, this.issues)
  }
  
}
