function packet(originalPacket, format) {

  try {

    switch (format) {
      case `full`:

        return originalPacket._source

      default: // simple format

      let source
      if (
        originalPacket._source.layers.btle[`btle.scanning_address`] ||
        originalPacket._source.layers.btle[`btle.advertising_address`]
      ) {

        source = originalPacket._source.layers.btle[`btle.scanning_address`] || originalPacket._source.layers.btle[`btle.advertising_address`]

      } else {
        
        source = originalPacket._source.layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? originalPacket._source.layers.btle[`btle.slave_bd_addr`] : originalPacket._source.layers.btle[`btle.master_bd_addr`]
        
      }
      
      let destination = {}
      if (
        originalPacket._source.layers.btle[`btle.master_bd_addr`] ||
        originalPacket._source.layers.btle[`btle.slave_bd_addr`]
      ) {

        destination.type = `direct`

        destination.address = originalPacket._source.layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? originalPacket._source.layers.btle[`btle.master_bd_addr`] : originalPacket._source.layers.btle[`btle.slave_bd_addr`]
          
      } else if (originalPacket._source.layers.btle[`btle.advertising_header`] && originalPacket._source.layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {

        switch (originalPacket._source.layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {
          case `0x00000005`:
            destination.type = `connect_req`
            break;
          case `0x00000003`:
            destination.type = `scan_req`
            break;
        
          default:
            destination.type = `req`
            break;
        }

        destination.address = originalPacket._source.layers.btle[`btle.advertising_address`]
        
        
      } else {
        destination.type = `broadcast`
      }

        return {
          packetId: Number(originalPacket._source.layers.frame[`frame.number`]),
          microseconds: Number(originalPacket._source.layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``)),
          source,
          destination,
          protocols: originalPacket._source.layers.frame[`frame.protocols`].split(`:`),
          length: Number(originalPacket._source.layers.frame[`frame.len`]),
        }
      
    }
    
  } catch (err) {
    console.error(err)
  }
  
}
module.exports.packet = packet
