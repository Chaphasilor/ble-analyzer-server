const StreamArray = require('stream-json/streamers/StreamArray');
const fs = require('fs');
const { spawn } = require(`child_process`)

let inputStream
if (process.argv.length > 2) {
  inputStream = fs.createReadStream(process.argv[2])
} else {
  inputStream = process.stdin
}

let tshark = spawn(`C:/Program Files/Wireshark/tshark`, [`-i`, `-`, `-T`, `json`])

const pipeline = tshark.stdout
  .pipe(StreamArray.withParser());
tshark.stdout.on('data', (data) => {
  // console.log(`stdout: ${data}`)
});

tshark.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`)
});
inputStream.pipe(tshark.stdin)

pipeline.on('data', data => {

  console.log(data.value)
  
});

pipeline.on(`close`, () => {
  console.log(`Done`)
})