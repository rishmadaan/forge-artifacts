// The name forge was started as: forge, or forgee where another program owns
// that name (bin/install). bin/forge records it once in FORGE_INVOKED_AS, so
// every command it prints for someone to run, from any layer and from the copy
// the store lock re-launches, names this tool and never the other program.
module.exports = () => process.env.FORGE_INVOKED_AS || "forge";
// A path in a printed command someone will run: as it is when every character
// is safe in a shell word, else in single quotes (a quote inside becomes '\'').
// Joined, never a pattern replacement, so no character in it is read as one.
module.exports.shq = (s) => (/^[A-Za-z0-9_\/.,:@+-]+$/.test(s) ? s : "'" + String(s).split("'").join("'\\''") + "'");
