FROM ekidd/rust-musl-builder:1.41.0 AS builder
COPY . ./
RUN cargo b --release --bin cddl

FROM scratch
COPY --from=builder /home/rust/src/target/x86_64-unknown-linux-musl/release/cddl /
ENTRYPOINT [ "/cddl" ]