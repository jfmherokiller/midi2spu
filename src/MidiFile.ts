
interface IEvent {
    deltaTime: number,
    type: string,
    subtype: string,

    key?: number,
    scale?: number,

    text?: string,
    channel?: number,
    programNumber?: number,
    controllerType?: number,

    numerator?: number,
    denominator?: number,
    metronome?: number,
    thirtyseconds?: number,

    microsecondsPerBeat?: number,

    value?: number,

    noteNumber?: number,
    velocity?: number,
    number?: number,
    frameRate?: number,
    hour?: number,
    min?: number,
    sec?: number,
    frame?: number,
    amount?: number,
    data?: any,
    subframe?: number,
}

class MidiHeader
{
    ticksPerBeat: number;
    trackCount: number;
    formatType: number;

    constructor(formatype: number, trackCount: number, ticksPerBeat: number) {
        this.formatType = formatype;
        this.trackCount = trackCount;
        this.ticksPerBeat = ticksPerBeat;
    }
}
class Chunk {
    id: string;
    length: number;
    data: string;
    constructor(newid: string, newlength: number, newdata: string) {
        this.id = newid;
        this.length = newlength;
        this.data = newdata;
    }
}

class Midifile {
    lastEventTypeByte;
    header:MidiHeader;
    stream: StringStream;
    tracks:IEvent[][] = new Array();
    constructor(data: string) {
        let ticksPerBeat: number;
        this.stream = new StringStream(data);
        const headerChunk = this.readChunk(this.stream);
        if (headerChunk.id !== "MThd" || headerChunk.length !== 6) {
            throw "Bad .mid file - header not found";
        }
        var headerStream = new StringStream(headerChunk.data);
        var formatType = headerStream.readInt16();
        var trackCount = headerStream.readInt16();
        var timeDivision = headerStream.readInt16();

        if (timeDivision & 0x8000) {
            throw "Expressing time division in SMTPE frames is not supported yet";
        } else {
            ticksPerBeat = timeDivision;
        }
        this.header = new MidiHeader(formatType, trackCount, ticksPerBeat);

        for (let i = 0; i < this.header.trackCount; i++) {
            this.tracks[i] = new Array<IEvent>();
            let trackChunk = this.readChunk(this.stream);
            if (trackChunk.id !== "MTrk") {
                throw "Unexpected chunk - expected MTrk, got " + trackChunk.id;
            }
            let trackStream = new StringStream(trackChunk.data);
            while (!trackStream.eof()) {
                var event = this.readEvent(trackStream);
                this.tracks[i].push(event);
                //console.log(event);
            }
        }
    }
    readChunk(stream: StringStream): Chunk {
        const id = stream.read(4);
        const length = stream.readInt32();
        return new Chunk(id, length, stream.read(length));
    }
    readEvent(stream:StringStream) {
        var event = <IEvent>({});
        event.deltaTime = stream.readVarInt();
        var eventTypeByte = stream.readInt8();
        if ((eventTypeByte & 0xf0) === 0xf0) {
            /* system / meta event */
            var length: number;
            if (eventTypeByte === 0xff) {
                /* meta event */
                event.type = "meta";
                var subtypeByte = stream.readInt8();
                length = stream.readVarInt();
                switch (subtypeByte) {
                    case 0x00:
                        event.subtype = "sequenceNumber";
                        if (length !== 2) throw "Expected length for sequenceNumber event is 2, got " + length;
                        event.number = stream.readInt16();
                        return event;
                    case 0x01:
                        event.subtype = "text";
                        event.text = stream.read(length);
                        return event;
                    case 0x02:
                        event.subtype = "copyrightNotice";
                        event.text = stream.read(length);
                        return event;
                    case 0x03:
                        event.subtype = "trackName";
                        event.text = stream.read(length);
                        return event;
                    case 0x04:
                        event.subtype = "instrumentName";
                        event.text = stream.read(length);
                        return event;
                    case 0x05:
                        event.subtype = "lyrics";
                        event.text = stream.read(length);
                        return event;
                    case 0x06:
                        event.subtype = "marker";
                        event.text = stream.read(length);
                        return event;
                    case 0x07:
                        event.subtype = "cuePoint";
                        event.text = stream.read(length);
                        return event;
                    case 0x20:
                        event.subtype = "midiChannelPrefix";
                        if (length !== 1) throw "Expected length for midiChannelPrefix event is 1, got " + length;
                        event.channel = stream.readInt8();
                        return event;
                    case 0x2f:
                        event.subtype = "endOfTrack";
                        if (length !== 0) throw "Expected length for endOfTrack event is 0, got " + length;
                        return event;
                    case 0x51:
                        event.subtype = "setTempo";
                        if (length !== 3) throw "Expected length for setTempo event is 3, got " + length;
                        event.microsecondsPerBeat = (
                            (stream.readInt8() << 16)
                            + (stream.readInt8() << 8)
                            + stream.readInt8()
                        );
                        return event;
                    case 0x54:
                        event.subtype = "smpteOffset";
                        if (length !== 5) throw "Expected length for smpteOffset event is 5, got " + length;
                        var hourByte = stream.readInt8();
                        event.frameRate = {
                            0x00: 24, 0x20: 25, 0x40: 29, 0x60: 30
                        }[hourByte & 0x60];
                        event.hour = hourByte & 0x1f;
                        event.min = stream.readInt8();
                        event.sec = stream.readInt8();
                        event.frame = stream.readInt8();
                        event.subframe = stream.readInt8();
                        return event;
                    case 0x58:
                        event.subtype = "timeSignature";
                        if (length !== 4) throw "Expected length for timeSignature event is 4, got " + length;
                        event.numerator = stream.readInt8();
                        event.denominator = Math.pow(2, stream.readInt8());
                        event.metronome = stream.readInt8();
                        event.thirtyseconds = stream.readInt8();
                        return event;
                    case 0x59:
                        event.subtype = "keySignature";
                        if (length !== 2) throw "Expected length for keySignature event is 2, got " + length;
                        event.key = stream.readInt8(true);
                        event.scale = stream.readInt8();
                        return event;
                    case 0x7f:
                        event.subtype = "sequencerSpecific";
                        event.data = stream.read(length);
                        return event;
                    default:
                        // console.log("Unrecognised meta event subtype: " + subtypeByte);
                        event.subtype = "unknown";
                        event.data = stream.read(length);
                        return event;
                }
                //event.data = stream.read(length);
                //return event;
            } else if (eventTypeByte === 0xf0) {
                event.type = "sysEx";
                length = stream.readVarInt();
                event.data = stream.read(length);
                return event;
            } else if (eventTypeByte === 0xf7) {
                event.type = "dividedSysEx";
                length = stream.readVarInt();
                event.data = stream.read(length);
                return event;
            } else {
                throw "Unrecognised MIDI event type byte: " + eventTypeByte;
            }
        } else {
            /* channel event */
            var param1;
            if ((eventTypeByte & 0x80) === 0) {
                /* running status - reuse lastEventTypeByte as the event type.
                    eventTypeByte is actually the first parameter
                */
                param1 = eventTypeByte;
                eventTypeByte = this.lastEventTypeByte;
            } else {
                param1 = stream.readInt8();
                this.lastEventTypeByte = eventTypeByte;
            }
            var eventType = eventTypeByte >> 4;
            event.channel = eventTypeByte & 0x0f;
            event.type = "channel";
            switch (eventType) {
                case 0x08:
                    event.subtype = "noteOff";
                    event.noteNumber = param1;
                    event.velocity = stream.readInt8();
                    return event;
                case 0x09:
                    event.noteNumber = param1;
                    event.velocity = stream.readInt8();
                    if (event.velocity === 0) {
                        event.subtype = "noteOff";
                    } else {
                        event.subtype = "noteOn";
                    }
                    return event;
                case 0x0a:
                    event.subtype = "noteAftertouch";
                    event.noteNumber = param1;
                    event.amount = stream.readInt8();
                    return event;
                case 0x0b:
                    event.subtype = "controller";
                    event.controllerType = param1;
                    event.value = stream.readInt8();
                    return event;
                case 0x0c:
                    event.subtype = "programChange";
                    event.programNumber = param1;
                    return event;
                case 0x0d:
                    event.subtype = "channelAftertouch";
                    event.amount = param1;
                    return event;
                case 0x0e:
                    event.subtype = "pitchBend";
                    event.value = param1 + (stream.readInt8() << 7);
                    return event;
                default:
                    throw `Unrecognised MIDI event type: ${eventType}`;
                /* 
                console.log("Unrecognised MIDI event type: " + eventType);
                stream.readInt8();
                event.subtype = 'unknown';
                return event;
                */
            }
        }
    }

}

/* Wrapper for accessing strings through sequential reads */
class StringStream {
    position = 0;
    str: string;
    constructor(inputstring: string) {
        this.str = inputstring;
    }



    read(length) {
        var result = this.str.substr(this.position, length);
        this.position += length;
        return result;
    }

    /* read a big-endian 32-bit integer */
    readInt32() {
        var result = (
            (this.str.charCodeAt(this.position) << 24)
            + (this.str.charCodeAt(this.position + 1) << 16)
            + (this.str.charCodeAt(this.position + 2) << 8)
            + this.str.charCodeAt(this.position + 3));
        this.position += 4;
        return result;
    }

    /* read a big-endian 16-bit integer */
    readInt16() {
        var result = (
            (this.str.charCodeAt(this.position) << 8)
            + this.str.charCodeAt(this.position + 1));
        this.position += 2;
        return result;
    }

    /* read an 8-bit integer */

    readInt8(signed?): number {
        let result = this.str.charCodeAt(this.position);
        if (signed && result > 127) {
            result -= 256;
        }
        this.position += 1;
        return result;
    }


    eof() {
        return this.position >= this.str.length;
    }

	/* read a MIDI-style variable-length integer
		(big-endian value in groups of 7 bits,
		with top bit set to signify that another byte follows)
	*/

    readVarInt() {
        let result = 0;
        while (true) {
            var b = this.readInt8();
            if (b & 0x80) {
                result += (b & 0x7f);
                result <<= 7;
            } else {
                /* b is the last byte */
                return result + b;
            }
        }
    }
}

export {Midifile}