module beta (
    input  wire        clk,
    input  wire [3:0]  sw,
    output logic       led
);
    assign led = ^sw;
endmodule
