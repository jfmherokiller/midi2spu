import {MidiDivision} from "./midiTiming";

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
    division: MidiDivision;
    trackCount: number;
    formatType: number;

    constructor(formatype: number, trackCount: number, division: MidiDivision) {
        this.formatType = formatype;
        this.trackCount = trackCount;
        this.division = division;
    }
}
class Chunk {
    id: string;
    length: number;
    data: ArrayBuffer;
    constructor(newid: string, newlength: number, newdata: ArrayBuffer) {
        this.id = newid;
        this.length = newlength;
        this.data = newdata;
    }
}

class Midifile {
    lastEventTypeByte;
    header:MidiHeader;
    stream: ByteStream;
    tracks:IEvent[][] = new Array();
    constructor(data: ArrayBuffer) {
        this.stream = new ByteStream(data);
        const headerChunk = this.readChunk(this.stream);
        if (headerChunk.id !== "MThd" || headerChunk.length !== 6) {
            throw "Bad .mid file - header not found";
        }
        var headerStream = new ByteStream(headerChunk.data);
        var formatType = headerStream.readInt16();
        var trackCount = headerStream.readInt16();
        var timeDivision = headerStream.readInt16();

        let division: MidiDivision;
        if (timeDivision & 0x8000) {
            /* SMPTE time division: top byte is the frame rate stored as a negative two's-
               complement byte (-24/-25/-29/-30 for 24/25/29.97/30 fps), bottom byte is ticks per
               frame. No beat/tempo concept applies to these files at all - see midiTiming.ts. */
            let rawFrameByte = (timeDivision >> 8) & 0xff;
            let framesPerSecond = -(rawFrameByte > 127 ? rawFrameByte - 256 : rawFrameByte);
            let ticksPerFrame = timeDivision & 0xff;
            division = {type: "smpte", framesPerSecond, ticksPerFrame};
        } else {
            division = {type: "ppqn", ticksPerBeat: timeDivision};
        }
        this.header = new MidiHeader(formatType, trackCount, division);

        /* The spec requires readers to tolerate non-MTrk chunks appearing anywhere a chunk is
           expected ("Your programs should expect alien chunks and treat them as if they weren't
           there") - so this keeps reading chunks, silently skipping anything that isn't MTrk,
           until trackCount real track chunks have been collected. readChunk always consumes
           exactly the right number of bytes (via the chunk's own length field) whether or not we
           keep it, so skipping is just "don't push it, keep looping". */
        let tracksFound = 0;
        while (tracksFound < this.header.trackCount) {
            if (this.stream.eof()) {
                throw "Unexpected end of file - expected " + this.header.trackCount
                    + " MTrk chunks, found " + tracksFound;
            }
            let chunk = this.readChunk(this.stream);
            if (chunk.id !== "MTrk") {
                continue;
            }
            let track = new Array<IEvent>();
            let trackStream = new ByteStream(chunk.data);
            while (!trackStream.eof()) {
                var event = this.readEvent(trackStream);
                track.push(event);
                //console.log(event);
            }
            this.tracks[tracksFound] = track;
            tracksFound++;
        }
    }
    readChunk(stream: ByteStream): Chunk {
        const id = stream.readString(4);
        const length = stream.readInt32();
        return new Chunk(id, length, stream.readBytes(length));
    }
    readEvent(stream:ByteStream) {
        var event = <IEvent>({});
        event.deltaTime = stream.readVarInt();
        var eventTypeByte = stream.readInt8();
        if ((eventTypeByte & 0xf0) === 0xf0) {
            /* system / meta event - none of these are valid running-status targets (running
               status only applies to channel voice messages), and sysex/meta explicitly cancel
               any running status per spec. Reset unconditionally here rather than only for the
               cases that historically mattered, so a channel event immediately after any of these
               correctly requires its own explicit status byte instead of silently reusing
               whatever channel status happened to precede it. */
            this.lastEventTypeByte = undefined;
            var length: number;
            if (eventTypeByte === 0xff) {
                /* meta event */
                event.type = "meta";
                var subtypeByte = stream.readInt8();
                length = stream.readVarInt();
                switch (subtypeByte) {
                    case 0x00: {
                        /* Real-world files don't always match the spec's declared field lengths
                           exactly (e.g. a non-standard encoder omitting trailing timeSignature
                           bytes - found via a real file, "Moveslikejagger.mid"). Rather than
                           throwing on any length mismatch, read whatever fields the declared
                           length actually allows, default the rest, and always leave the stream
                           at exactly `end` (declared start + length) afterward regardless of how
                           many fields were actually read - this keeps every later event's
                           position correct even for a malformed or vendor-padded field, which
                           matters far more than getting every field of a rarely-used meta event
                           exactly right. */
                        event.subtype = "sequenceNumber";
                        const end = stream.position + length;
                        event.number = length >= 2 ? stream.readInt16() : 0;
                        stream.position = end;
                        return event;
                    }
                    case 0x01:
                        event.subtype = "text";
                        event.text = stream.readString(length);
                        return event;
                    case 0x02:
                        event.subtype = "copyrightNotice";
                        event.text = stream.readString(length);
                        return event;
                    case 0x03:
                        event.subtype = "trackName";
                        event.text = stream.readString(length);
                        return event;
                    case 0x04:
                        event.subtype = "instrumentName";
                        event.text = stream.readString(length);
                        return event;
                    case 0x05:
                        event.subtype = "lyrics";
                        event.text = stream.readString(length);
                        return event;
                    case 0x06:
                        event.subtype = "marker";
                        event.text = stream.readString(length);
                        return event;
                    case 0x07:
                        event.subtype = "cuePoint";
                        event.text = stream.readString(length);
                        return event;
                    case 0x20: {
                        event.subtype = "midiChannelPrefix";
                        const end = stream.position + length;
                        event.channel = length >= 1 ? stream.readInt8() : 0;
                        stream.position = end;
                        return event;
                    }
                    case 0x2f:
                        event.subtype = "endOfTrack";
                        stream.position += length; // normally 0; tolerate stray trailing bytes
                        return event;
                    case 0x51: {
                        event.subtype = "setTempo";
                        const end = stream.position + length;
                        const b0 = length >= 1 ? stream.readInt8() : 0;
                        const b1 = length >= 2 ? stream.readInt8() : 0;
                        const b2 = length >= 3 ? stream.readInt8() : 0;
                        event.microsecondsPerBeat = (b0 << 16) + (b1 << 8) + b2;
                        stream.position = end;
                        return event;
                    }
                    case 0x54: {
                        event.subtype = "smpteOffset";
                        const end = stream.position + length;
                        var hourByte = length >= 1 ? stream.readInt8() : 0;
                        event.frameRate = {
                            0x00: 24, 0x20: 25, 0x40: 29, 0x60: 30
                        }[hourByte & 0x60];
                        event.hour = hourByte & 0x1f;
                        event.min = length >= 2 ? stream.readInt8() : 0;
                        event.sec = length >= 3 ? stream.readInt8() : 0;
                        event.frame = length >= 4 ? stream.readInt8() : 0;
                        event.subframe = length >= 5 ? stream.readInt8() : 0;
                        stream.position = end;
                        return event;
                    }
                    case 0x58: {
                        event.subtype = "timeSignature";
                        const end = stream.position + length;
                        // Defaults match the spec's own "usual" values (24 clocks/click, 8
                        // 32nds/quarter) for whichever trailing fields a short declaration omits.
                        event.numerator = length >= 1 ? stream.readInt8() : 4;
                        event.denominator = length >= 2 ? Math.pow(2, stream.readInt8()) : 4;
                        event.metronome = length >= 3 ? stream.readInt8() : 24;
                        event.thirtyseconds = length >= 4 ? stream.readInt8() : 8;
                        stream.position = end;
                        return event;
                    }
                    case 0x59: {
                        event.subtype = "keySignature";
                        const end = stream.position + length;
                        event.key = length >= 1 ? stream.readInt8(true) : 0;
                        event.scale = length >= 2 ? stream.readInt8() : 0;
                        stream.position = end;
                        return event;
                    }
                    case 0x7f:
                        event.subtype = "sequencerSpecific";
                        event.data = stream.readBytes(length);
                        return event;
                    default:
                        // console.log("Unrecognised meta event subtype: " + subtypeByte);
                        event.subtype = "unknown";
                        event.data = stream.readBytes(length);
                        return event;
                }
                //event.data = stream.readBytes(length);
                //return event;
            } else if (eventTypeByte === 0xf0) {
                event.type = "sysEx";
                length = stream.readVarInt();
                event.data = stream.readBytes(length);
                return event;
            } else if (eventTypeByte === 0xf7) {
                event.type = "dividedSysEx";
                length = stream.readVarInt();
                event.data = stream.readBytes(length);
                return event;
            } else if (eventTypeByte >= 0xf1 && eventTypeByte <= 0xf6) {
                /* System common messages - rare in a standard MIDI file (they're mostly a live-
                   performance/sync concept: MTC quarter frame, song position pointer, song
                   select, tune request) but technically legal, and not note-relevant, so this
                   just consumes the right number of data bytes per spec and moves on instead of
                   crashing the whole parse over a byte getnotes() would never look at anyway. */
                event.type = "systemCommon";
                event.subtype = "unknown";
                const dataLength = eventTypeByte === 0xf2 ? 2 : (eventTypeByte === 0xf6 ? 0 : 1);
                event.data = stream.readBytes(dataLength);
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
                if (this.lastEventTypeByte === undefined) {
                    throw "Running status used without a preceding channel status byte (or after "
                        + "a status-cancelling meta/sysex/system event) - malformed MIDI file";
                }
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

/* Wrapper for accessing an ArrayBuffer through sequential reads */
class ByteStream {
    position = 0;
    view: DataView;
    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }

    /* read `length` bytes and return them as a new ArrayBuffer */
    readBytes(length: number): ArrayBuffer {
        var result = this.view.buffer.slice(
            this.view.byteOffset + this.position,
            this.view.byteOffset + this.position + length
        ) as ArrayBuffer;
        this.position += length;
        return result;
    }

    /* read `length` bytes and decode them as Latin1/ASCII text
       (MIDI chunk IDs and meta-event text are single-byte-per-char) */
    readString(length: number): string {
        let result = "";
        for (let i = 0; i < length; i++) {
            result += String.fromCharCode(this.view.getUint8(this.position + i));
        }
        this.position += length;
        return result;
    }

    /* read a big-endian 32-bit integer */
    readInt32() {
        var result = this.view.getUint32(this.position);
        this.position += 4;
        return result;
    }

    /* read a big-endian 16-bit integer */
    readInt16() {
        var result = this.view.getUint16(this.position);
        this.position += 2;
        return result;
    }

    /* read an 8-bit integer */

    readInt8(signed?): number {
        let result = signed ? this.view.getInt8(this.position) : this.view.getUint8(this.position);
        this.position += 1;
        return result;
    }


    eof() {
        return this.position >= this.view.byteLength;
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