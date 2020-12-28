const fs = require(`fs`)

let dataAvailable = true
let buffers = []

// let fd = fs.openSync(`../capture_cypress_psoc6_crash_llid.pcapng`)

// while (dataAvailable) {

//   fs.read(fd, (err, bytesRead, buf) => {

//     if (err) {
//       throw Error(`Error while reading file:`, err)
//     }
    
//     buffers.push(buf)
//     console.log(`bytesRead:`, bytesRead);
//     dataAvailable = bytesRead > 0
    
//   })
  
// }

// let fullBuffer = Buffer.concat(buffers)

let data = ``
let position = 0
let input = fs.createReadStream(`../capture_cypress_psoc6_crash_llid.pcapng`, {
  encoding: `hex`,
})

let pcapngHeader;

input.on(`data`, (chunk) => {
  
  position += chunk.length
  data += chunk

  if (position >= 80 && !pcapngHeader) {

    pcapngHeader = data.slice(0, 80)
    data = data.slice(80)
    
  }
  
})

input.on(`end`, () => {

  console.log(data.length)
  console.log(`pcapngHeader:`, pcapngHeader);

  if (pcapngHeader !== `d4c3b2a1020004000000000000000000ffff000010010000894c185ecd6009002600000026000000`) {
    throw new Error(`Unrecognized header!`)
  }
  
})

// console.log(input.toString(`hex`))
