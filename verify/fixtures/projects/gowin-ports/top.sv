/* top module for Gowin CST parsing tests */
module top #(parameter W = 8) (
    input  logic         clk,        // system clock
    input  wire [W-1:0]  din,        /* data in */
    output reg  [3:0]    cnt,        // counter
    inout  wire          sda,
    output logic         done
);
endmodule
