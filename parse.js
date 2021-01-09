const StreamArray = require('stream-json/streamers/StreamArray');
const fs = require('fs');
const { spawn } = require(`child_process`)
const EventEmitter = require(`events`)
const CBuffer = require(`cbuffer`)

module.exports = class Parser extends EventEmitter {

  constructor() {

    super()

    this.packetBuffer = new CBuffer(100000) // only remember the last 100000 packets

    if (process.argv.length > 2) {
      this.inputStream = fs.createReadStream(process.argv[2])
    } else {
      this.inputStream = process.stdin
    }
    
    this.tshark = spawn(`C:/Program Files/Wireshark/tshark`, [`-i`, `-`, `-T`, `json`])
    
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
      
    });
    
    this.pipeline.on(`close`, () => {

      console.log(`Done`)
      this.emit(`end`)

    })
    
  }
  
}
