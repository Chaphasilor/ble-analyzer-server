function packet(originalPacket, format) {

  try {

    switch (format) {
      default: // simple format
      
        return {
          packetId: Number(originalPacket._source.layers.frame[`frame.number`]),
          microseconds: Number(originalPacket._source.layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``)),
          source: originalPacket._source.layers.btle[`btle.scanning_address`] ?
            originalPacket._source.layers.btle[`btle.scanning_address`] :
            originalPacket._source.layers.btle[`btle.advertising_address`],
          destination: {
            type: originalPacket._source.layers.btle[`btle.scanning_address`] ?
              `direct` :
              `broadcast`,
            address: originalPacket._source.layers.btle[`btle.scanning_address`] ?
              originalPacket._source.layers.btle[`btle.advertising_address`] :
              undefined,
          },
          protocols: originalPacket._source.layers.frame[`frame.protocols`].split(`:`),
          length: Number(originalPacket._source.layers.frame[`frame.len`]),
        }
      
    }
    
  } catch (err) {
    console.error(err)
  }
  
}
module.exports.packet = packet
