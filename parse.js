const StreamArray = require('stream-json/streamers/StreamArray');
const fs = require('fs');
const { spawn } = require(`child_process`)
const EventEmitter = require(`events`)
const CBuffer = require(`cbuffer`)

const Interpret = require(`./interpret`)

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
      this.packetBuffer.push(data.value)
      this.emit(`packet`, data.value)
      let connection = Interpret.connection(data.value)
      // if the packet contains a connection and the connection hasn't been included before, emit the event
      if (connection) {

        if (this.connections.has(connection.accessAddress)) {
          this.connections.get(connection.accessAddress).packets += 1
        } else {

          connection.packets = 1;
          this.connections.set(connection.accessAddress, connection)
          this.emit(`new-connection`, [...this.connections.values()])

        }

      }

      let advertisement = Interpret.advertisement(data.value)

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
