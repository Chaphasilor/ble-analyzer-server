function packet(originalPacket, format) {

  try {

    let info = getPacketInfo(originalPacket)

    switch (format) {
      case `full`:

        // return originalPacket._source
        return {...info,

        }

      default: // simple format

        return {
          packetId: info.packetId,
          microseconds: info.microseconds,
          source: info.source,
          destination: info.destination,
          protocols: info.protocols.map(protocol => protocol.name),
          length: info.length,
        }
      
    }
    
  } catch (err) {
    console.error(err)
  }
  
}
module.exports.packet = packet

function getPacketInfo(originalPacket) {

  //TODO extract all information but only return selected infomation in the packet() function
  //TODO first determine type, then source & destination

  let layers = originalPacket._source.layers
  let source = {}, destination = {}

  // determine source
  if (
    layers.btle[`btle.scanning_address`] ||
    layers.btle[`btle.advertising_address`] ||
    layers.btle[`btle.initiator_address`] 
  ) {

    source = layers.btle[`btle.scanning_address`] || layers.btle[`btle.initiator_address`] ||
    layers.btle[`btle.advertising_address`]

  } else {
    
    source = layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? layers.btle[`btle.slave_bd_addr`] : layers.btle[`btle.master_bd_addr`]
    
  }
  
  // determine destination
  if (
    layers.btle[`btle.master_bd_addr`] ||
    layers.btle[`btle.slave_bd_addr`]
  ) {

    destination.type = `direct`

    destination.address = layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? layers.btle[`btle.master_bd_addr`] : layers.btle[`btle.slave_bd_addr`]
      
  } else if (layers.btle[`btle.advertising_header`] && layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {

    switch (layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {
      case `0x00000005`:
        destination.type = `connect_req`
        destination.address = layers.btle[`btle.advertising_address`]
        break;
      case `0x00000003`:
        destination.type = `scan_req`
        destination.address = layers.btle[`btle.advertising_address`]
        break;
    
      default:
        destination.type = `broadcast`
        break;
    }

    
  } else {
    destination.type = `broadcast`
  }

  return {
    packetId: Number(layers.frame[`frame.number`]),
    microseconds: Number(layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``)),
    channel: Number(layers.nordic_ble[`nordic_ble.channel`]),
    source,
    destination,
    protocols: layers.frame[`frame.protocols`].split(`:`).map(protocolName => {

      switch (protocolName) {
        case `btle`:
          return {
            name: `BT LE Link Layer`,
            length: layers.btle[`btle.length`],
            accessAddress: layers.btle[`btle.access_address`],
            header: layers.btle[`btle.advertising_header_tree`] ? Object.entries(layers.btle[`btle.advertising_header_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btle.advertising_header.`, ``)] = value
              return obj
            }, {}) : {},
            crc: layers.btle[`btle.crc`],
          }
          break;
      
        case `nordic_ble`:
          return {
            name: `Nordic BLT Sniffer`,
            length: layers.nordic_ble[`nordic_ble.len`],
            boardId: layers.nordic_ble[`nordic_ble.board_id`],
            flags: Object.entries(layers.nordic_ble[`nordic_ble.flags_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`nordic_ble.`, ``)] = value
              return obj
            }, {}),
            crc: layers.btle[`btle.crc`],
          }
          break;
      
        default:
          return {
            name: `<unknown protocol> (${protocolName})`
          }
          break;
      }
      
    }),
    length: Number(layers.frame[`frame.len`]),
  }
  
}